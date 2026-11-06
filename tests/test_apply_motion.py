import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "apply-motion.py"
SPEC = importlib.util.spec_from_file_location("apply_motion", SCRIPT)
MOTION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOTION)


class ApplyMotionTests(unittest.TestCase):
    def test_build_keyframes_uses_studio_schema_and_closes_loop(self):
        layer = {"x": 10, "y": 20, "w": 30, "h": 40, "opacity": 1, "rotation": 0}
        frames = MOTION.build_keyframes(
            layer,
            {"ax": 0.8, "ay": 0.1, "cycles": 1},
            duration=9000,
            fps=12,
        )

        self.assertEqual(len(frames), 109)
        self.assertEqual(frames[0]["time"], 0)
        self.assertEqual(frames[-1]["time"], 9000)
        self.assertEqual(
            {key: value for key, value in frames[0].items() if key != "time"},
            {key: value for key, value in frames[-1].items() if key != "time"},
        )
        self.assertEqual(set(frames[0]), {"time", "x", "y", "w", "h", "opacity", "rotation"})
        self.assertTrue(all(frames[i]["time"] < frames[i + 1]["time"] for i in range(len(frames) - 1)))

    def test_project_plan_uses_recovered_layers_and_static_reference_plate(self):
        project = ROOT / "data" / "projects" / "0---Scotland-View"
        composition = json.loads(
            (project / "compositions" / "0---Scotland-View.composition.json").read_text(encoding="utf-8")
        )
        plan = json.loads((project / "motion.plan.json").read_text(encoding="utf-8"))

        result, counts = MOTION.apply_motion(composition, plan, fps=12)
        layers = {layer["name"]: layer for layer in result["layers"]}

        self.assertEqual(result["duration"], 9000)
        self.assertTrue(layers["Final image"]["visible"])
        self.assertTrue(layers["Final image"]["locked"])
        self.assertEqual(layers["Final image"]["keyframes"], [])
        self.assertGreater(counts["animated"], 0)
        for name in (
            "sunset-sky-upper",
            "sunset-clouds-vibrant",
            "sunset-clouds-vibrant-recovered-02",
            "ocean-near-water",
            "ocean-near-water-recovered-02",
            "crashing-ocean-waves",
            "crashing-ocean-waves-recovered-04",
            "foreground-grass-bank",
            "foreground-grass-bank-recovered-02",
        ):
            frames = layers[name]["keyframes"]
            self.assertGreaterEqual(len(frames), 2, name)
            self.assertEqual(
                {key: value for key, value in frames[0].items() if key != "time"},
                {key: value for key, value in frames[-1].items() if key != "time"},
                name,
            )
            self.assertIn("time", frames[0], name)
            self.assertNotIn("t", frames[0], name)
            self.assertNotIn("values", frames[0], name)

    def test_unmatched_layer_keeps_existing_keyframes(self):
        keyframes = [{"time": 0, "x": 1}]
        composition = {
            "duration": 1000,
            "referenceLayerId": None,
            "layers": [{
                "id": "untouched",
                "name": "untouched",
                "x": 0, "y": 0, "w": 10, "h": 10,
                "rotation": 0, "opacity": 1, "keyframes": keyframes,
            }],
        }
        result, counts = MOTION.apply_motion(
            composition,
            {"rules": [{"match": "other-*", "ax": 0.1}]},
        )

        self.assertEqual(result["layers"][0]["keyframes"], keyframes)
        self.assertEqual(counts["untouched"], 1)

    def test_rejects_motion_above_safe_amplitude(self):
        with self.assertRaisesRegex(ValueError, "1% translation limit"):
            MOTION.validate_plan({"rules": [{"match": "*", "ax": 1.1}]})


if __name__ == "__main__":
    unittest.main()

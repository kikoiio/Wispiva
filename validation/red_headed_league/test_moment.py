"""The Red-Headed League moment is a private draft, not a scripted ending."""
import json
import unittest
from pathlib import Path

from genesis.compiler import compile_plan, public_plan

MOMENT = Path(__file__).with_name("moment.json")
SECRET = ("John Clay", "隧道", "抢劫", "金库")


class RedHeadedLeagueMomentTests(unittest.TestCase):
    def setUp(self):
        self.draft = json.loads(MOMENT.read_text(encoding="utf-8"))
        self.plan = compile_plan(self.draft)
        self.public = public_plan(self.plan)

    def test_stops_after_the_consultation_and_before_the_night(self):
        places = {place["id"]: place["placeId"] if "placeId" in place else place["id"]
                  for place in self.draft["actors"]}
        self.assertEqual(places["holmes"], "baker")
        self.assertEqual(places["watson"], "baker")
        self.assertEqual(places["wilson"], "baker")
        self.assertEqual(places["spaulding"], "pawnshop")
        self.assertNotIn("jones", places)
        self.assertNotIn("merryweather", places)

    def test_public_world_does_not_carry_the_conspiracy(self):
        visible = json.dumps(self.public, ensure_ascii=False)
        for word in SECRET:
            self.assertNotIn(word, visible)
        self.assertNotIn("尚未发生", visible)
        names = {actor["name"] for actor in self.public["actors"]}
        self.assertIn("Vincent Spaulding", names)
        self.assertNotIn("John Clay", names)

    def test_listeners_do_not_receive_spaulding_private_knowledge(self):
        private = self.plan["private_actors"]
        for actor_id in ("holmes", "watson", "wilson"):
            text = " ".join(private[actor_id]["memory_seeds"]) + private[actor_id]["goal"]
            for word in SECRET:
                self.assertNotIn(word, text, actor_id)
        hidden = " ".join(private["spaulding"]["memory_seeds"])
        self.assertIn("地窖", hidden)
        self.assertIn("银行", hidden)
        self.assertNotIn(hidden, json.dumps(self.public, ensure_ascii=False))

    def test_places_keep_public_descriptions_and_distinct_materials(self):
        by_id = {place["id"]: place for place in self.public["places"]}
        self.assertEqual(by_id["baker"]["description"], "Holmes 见客人的起居室。")
        self.assertEqual(by_id["pawnshop"]["description"], "萨克斯-科堡广场上的一家小当铺。")
        self.assertEqual(by_id["baker"]["wall"], "default:bookshelf")
        self.assertEqual(by_id["pawnshop"]["wall"], "default:brick")
        self.assertEqual(by_id["cellar"]["wall"], "default:cobble")
        self.assertEqual(by_id["cellar"]["floor"], "default:stone")
        self.assertNotIn("windows", by_id["cellar"])
        self.assertEqual(by_id["bank"]["wall"], "default:stonebrick")
        self.assertIs(by_id["bank"]["windows"], True)
        self.assertGreaterEqual(len({place["wall"] for place in by_id.values()}), 4)

    def test_cellar_is_not_already_connected_to_the_bank(self):
        links = {(item["from"], item["to"]) for item in self.public["semantic_connections"]}
        self.assertIn(("cellar", "pawnshop"), links)
        self.assertNotIn(("bank", "cellar"), links)
        self.assertNotIn(("bank", "pawnshop"), links)


if __name__ == "__main__":
    unittest.main()

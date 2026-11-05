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
        self.assertEqual(places["spaulding"], "cellar")
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

    def test_places_keep_public_descriptions_and_reference_room(self):
        self.assertIn("仍不明白原因", self.public["description"])
        self.assertIn("查看贝克街的解散告示", self.public["description"])
        by_id = {place["id"]: place for place in self.public["places"]}
        self.assertEqual(by_id["baker"]["description"], "Holmes 见客人的起居室。")
        self.assertEqual(by_id["pawnshop"]["description"], "萨克斯-科堡广场上的一家小当铺。")
        self.assertEqual(by_id["baker"]["blueprint"], "victorian_sitting_room_v1")
        self.assertNotIn("wall", by_id["baker"])
        self.assertEqual(by_id["pawnshop"]["wall"], "default:brick")
        self.assertEqual(by_id["cellar"]["wall"], "default:cobble")
        self.assertEqual(by_id["cellar"]["floor"], "default:stone")
        self.assertNotIn("windows", by_id["cellar"])
        self.assertEqual(by_id["bank"]["wall"], "default:stonebrick")
        self.assertIs(by_id["bank"]["windows"], True)

    def test_baker_pawnshop_cellar_and_bank_have_authored_routes(self):
        links = {(item["from"], item["to"]) for item in self.public["semantic_connections"]}
        self.assertIn(("baker", "pawnshop"), links)
        self.assertIn(("cellar", "pawnshop"), links)
        self.assertIn(("bank", "pawnshop"), links)
        self.assertNotIn(("bank", "cellar"), links)

    def test_cellar_is_a_real_lower_level_with_a_reachable_spaulding_start(self):
        by_id = {place["id"]: place for place in self.public["places"]}
        shop, cellar = by_id["pawnshop"], by_id["cellar"]
        self.assertEqual(shop["anchor"]["y"], 1)
        self.assertEqual(cellar["anchor"]["y"], -7)
        self.assertEqual((shop["anchor"]["x"], shop["anchor"]["z"]),
                         (cellar["anchor"]["x"], cellar["anchor"]["z"]))
        spaulding = next(actor for actor in self.public["actors"] if actor["actor_id"] == "spaulding")
        self.assertEqual(spaulding["place_id"], "cellar")
        self.assertEqual(spaulding["position"]["y"], -7)

    def test_story_objects_keep_sources_and_split_private_transitions(self):
        public_objects = {item["id"]: item for item in self.public["objects"]}
        private_objects = self.plan["private_objects"]
        self.assertEqual(set(public_objects), {"dissolution_notice", "cellar_workface"})
        self.assertEqual(public_objects["dissolution_notice"]["place_id"], "baker")
        self.assertEqual(public_objects["cellar_workface"]["place_id"], "cellar")
        self.assertEqual(public_objects["cellar_workface"]["position"],
                         {"x": 15, "y": -7, "z": -1})
        self.assertEqual(public_objects["cellar_workface"]["render_by_state"]["worked"],
                         "society:story_surface_disturbed")
        self.assertEqual(private_objects["dissolution_notice"]["facets"][0]["sourceRef"],
                         "docs/source-texts/sherlock-holmes/the-red-headed-league.txt#L435-L438")
        workface = private_objects["cellar_workface"]
        self.assertEqual(workface["transitions"], [
            {"id": "continue_cellar_work", "from": "quiet", "to": "worked"}])
        self.assertEqual(workface["grants"], [
            {"actorId": "spaulding", "transitionIds": ["continue_cellar_work"]}])
        self.assertEqual(workface["facets"][0]["epistemic"], "inference")
        self.assertEqual(workface["facets"][1]["epistemic"], "author")
        public_json = json.dumps(self.public, ensure_ascii=False)
        for forbidden in SECRET:
            self.assertNotIn(forbidden, public_json)
        self.assertNotIn("sourceRef", json.dumps(public_objects, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()

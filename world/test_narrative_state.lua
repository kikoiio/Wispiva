-- Run with a Lua 5.1 compatible interpreter: lua world/test_narrative_state.lua
local narrative = dofile((arg[1] or "world") .. "/narrative_state.lua")

local objects = {
  {id="notice", initial_state="posted", states={"posted"}, public=true,
    render_by_state={posted="society:story_notice"}, facets={{id="notice_text",
      state="posted", text="The League is dissolved.",
      sourceRef="docs/source-texts/sherlock-holmes/the-red-headed-league.txt#L435-L438",
      epistemic="observation"}}, transitions={}},
  {id="workface", initial_state="quiet", states={"quiet", "worked"}, public=true,
    render_by_state={quiet="society:story_surface", worked="society:story_surface_disturbed"},
    facets={{id="quiet_facet", state="quiet", text="A marked work surface.",
      sourceRef="docs/source-texts/sherlock-holmes/the-red-headed-league.txt#L183-L186",
      epistemic="inference"},
      {id="worked_facet", state="worked", text="The surface is freshly disturbed.",
        sourceRef="docs/source-texts/sherlock-holmes/the-red-headed-league.txt#L183-L186",
        epistemic="author"}},
    transitions={continue_cellar_work={from="quiet", to="worked", actors={"spaulding"}}}},
}
local grants = {holmes={}, watson={}, wilson={}, spaulding={workface=true}}
local state = narrative.new(objects, grants,
  {world_id="world-1", origin_event_id="genesis-1"})
local empty = narrative.new({}, {}, {world_id="empty-world", origin_event_id="empty-origin"})
local null_collections = narrative.export(empty)
null_collections.object_states = nil
null_collections.interactions = nil
null_collections.operations = nil
null_collections.offers = nil
local restored_empty = narrative.load(null_collections, {}, {},
  {world_id="empty-world", origin_event_id="empty-origin"})
assert(next(restored_empty.object_states) == nil and next(restored_empty.interactions) == nil
  and next(restored_empty.operations) == nil and next(restored_empty.offers) == nil)

local first = narrative.inspect(state, "inspect-1", "alice", "notice", 5)
assert(first.status == "accepted_this_run" and first.checkpointed == false)
assert(first.facets[1].sourceRef:find("L435%-L438"))
assert(narrative.inspect(state, "inspect-1", "alice", "notice", 5).interaction_id == first.interaction_id)
assert(narrative.inspect(state, "inspect-1", "alice", "workface", 5).reason == "operation_conflict")
local duplicate = narrative.inspect(state, "inspect-2", "alice", "notice", 5)
assert(duplicate.status == "already_discovered" and duplicate.interaction_id == first.interaction_id)
assert(#narrative.player_view(state, "alice").items == 1)
assert(#narrative.player_view(state, "bob").items == 0)

local addressed = narrative.address(state, "message-1", "alice", "spaulding", "What are you doing below the shop?", 6)
assert(addressed.status == "accepted_this_run" and addressed.lifecycle == "pending")
assert(narrative.address(state, "message-1", "alice", "spaulding", "Different text", 6).reason == "operation_conflict")
assert(narrative.actor_view(state, "holmes", "decision-h").messages[1] == nil)
local view = narrative.actor_view(state, "spaulding", "decision-s")
assert(#view.messages == 1 and view.messages[1].text == "What are you doing below the shop?")
assert(view.messages[1].source.kind == "player_message" and view.messages[1].audience.id == "spaulding")
assert(#view.granted_objects == 1 and view.granted_objects[1].id == "workface")
assert(view.granted_objects[1].transitions[1].id == "continue_cellar_work")
assert(narrative.commit_actor_result(state, "result-wrong", "holmes", "decision-h",
  {addressed.interaction_id}, true).reason == "not_offered")
local reply = narrative.apply_reply(state, "reply-1", "spaulding", addressed.interaction_id,
  "I was checking some photographs.", "decision-s")
assert(reply.status == "accepted_this_run" and reply.answered_id == addressed.interaction_id)
assert(narrative.apply_reply(state, "reply-2", "spaulding", addressed.interaction_id,
  "A second answer", "decision-s").reason == "already_answered")
assert(narrative.commit_actor_result(state, "result-1", "spaulding", "decision-s",
  {addressed.interaction_id}, true).status == "accepted_this_run")
local private = narrative.player_view(state, "alice").items
assert(#private == 3 and private[2].text == "What are you doing below the shop?")
assert(private[3].text == "I was checking some photographs.")
local public = narrative.public_view(state)
local public_json = table.concat({public.objects[1].id, tostring(#public.transitions)})
assert(not public_json:find("photographs", 1, true))

local denied = narrative.reduce_object(state, "work-by-watson", "watson", "workface",
  "continue_cellar_work", 0)
assert(denied.reason == "transition_forbidden")
local changed = narrative.reduce_object(state, "work-1", "spaulding", "workface",
  "continue_cellar_work", 0)
assert(changed.status == "accepted_this_run" and changed.revision == 1)
local object = narrative.object_view(state, "workface")
assert(object.state == "worked" and object.render_node == "society:story_surface_disturbed")
assert(object.facets[1].epistemic == "author")
assert(narrative.reduce_object(state, "work-1", "spaulding", "workface",
  "continue_cellar_work", 0).revision == 1)
assert(narrative.reduce_object(state, "work-2", "spaulding", "workface",
  "continue_cellar_work", 0).reason == "revision_conflict")

local restored = narrative.load(narrative.export(state), objects, grants,
  {world_id="world-1", origin_event_id="genesis-1"})
assert(narrative.object_view(restored, "workface").revision == 1)
assert(narrative.player_view(restored, "alice").items[3].text == "I was checking some photographs.")
assert(narrative.inspect(restored, "inspect-1", "alice", "notice", 5).checkpointed == true)
local corrupt = narrative.export(state)
corrupt.object_states.workface.state = "unknown"
assert(not pcall(narrative.load, corrupt, objects, grants,
  {world_id="world-1", origin_event_id="genesis-1"}))

local manifest = {world_id="world-2", origin_event_id="genesis-2",
  actors={{actor_id="spaulding"}}, public={objects={{id="workface",
    render_by_state={quiet="society:story_surface", worked="society:story_surface_disturbed"}}}},
  private_objects={workface={initial_state="quiet", states={"quiet", "worked"},
    facets=objects[2].facets, grants={{actorId="spaulding", transitionIds={"continue_cellar_work"}}},
    transitions={{id="continue_cellar_work", from="quiet", to="worked"}}}}}
local from_manifest = narrative.new_from_manifest(manifest)
local manifest_view = narrative.actor_view(from_manifest, "spaulding", "manifest-decision")
assert(manifest_view.granted_objects[1].transitions[1].expected_revision == 0)
local missing_actor, missing_reason = narrative.actor_view(from_manifest, "holmes", "unknown-actor")
assert(missing_actor == nil and missing_reason == "invalid_actor_or_decision")

print("narrative_state: 26 assertions passed")

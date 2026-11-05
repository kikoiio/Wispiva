local directory = (arg[0] or ""):match("^(.*[/\\])") or ""
local events = dofile(directory .. "world_events.lua")

local journal = events.new()
local first = journal:commit("agent:0:decision:1", {
  time = 1, kind = "say", actor = "0", ok = true, reason = "delivered",
  detail = "hello", participants = {"1"}, point = {x = 1, y = 2, z = 3},
})
assert(first.id == "world-event:1" and first.seq == 1)
local retry = journal:commit("agent:0:decision:1", {
  time = 1, kind = "say", actor = "0", ok = true, reason = "delivered",
  detail = "hello", participants = {"1"}, point = {x = 1, y = 2, z = 3},
})
assert(retry.id == first.id and journal:count() == 1)
assert(journal:get(first.id).detail == "hello")
local failed = journal:commit("agent:1:decision:2", {
  time = 2, kind = "build", actor = "1", ok = false, reason = "insufficient inventory",
})
assert(failed.id == "world-event:2" and journal:count() == 2)
local other_namespace = journal:commit("reset:agent:0:decision:1", {
  time = 3, kind = "inspect", actor = "0", ok = true, reason = "observed",
})
assert(other_namespace.id == "world-event:3" and journal:count() == 3)
assert(not pcall(function()
  journal:commit("agent:0:decision:1", {
    time = 1, kind = "say", actor = "0", ok = false, reason = "changed",
  })
end))
local snapshot = journal:export()
local restored = events.load(snapshot)
snapshot.events[1].detail = "tampered"
assert(restored:get(first.id).detail == "hello" and restored:count() == 3)
assert(not pcall(function()
  events.load({version = 1, events = {{id = "world-event:2", seq = 2, operation_id = "x",
    time = 1, kind = "say", actor = "0", ok = true, reason = "ok"}}})
end))
print("world events tests passed")

local empty = events.new()
local data = {time=4, kind="inspect", actor="0", ok=true, reason="observed", participants={}}
empty:commit("empty-participants", data)
local decoded = empty:export()
-- Luanti decodes the serialized empty table (JSON null) as a missing key.
decoded.events[1].participants = nil
local reloaded = events.load(decoded)
assert(type(reloaded:get("world-event:1").participants) == "table",
  "restored event lost its empty participants collection")
assert(reloaded:commit("empty-participants", data).id == "world-event:1",
  "restored empty-participant event is not idempotent")

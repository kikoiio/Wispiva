-- Pure Luanti-boundary test with an in-memory engine shim.
local narrative = dofile("world/narrative_state.lua")
local story_runtime = dofile("engine/luanti/mod/society/story_runtime.lua")
local nodes, metadata, forms, chats, commands = {}, {}, {}, {}, {}
local function position_key(p) return p.x .. "," .. p.y .. "," .. p.z end
local engine = {
  get_us_time=function() return 123456 end,
  sha1=function(value) return string.rep("a",40) .. string.format("%x",#value) end,
  formspec_escape=function(value) return tostring(value):gsub("%[", "\\["):gsub("%]", "\\]") end,
  show_formspec=function(name, formname, form) forms[#forms+1]={name=name, formname=formname, form=form} end,
  chat_send_player=function(name, text) chats[#chats+1]={name=name, text=text} end,
  register_chatcommand=function(name, definition) commands[name]=definition end,
  get_node=function(pos) return nodes[position_key(pos)] end,
  swap_node=function(pos, node) nodes[position_key(pos)]={name=node.name,param2=node.param2 or 0} end,
  get_meta=function(pos)
    local key=position_key(pos)
    metadata[key]=metadata[key] or {}
    local data=metadata[key]
    return {set_string=function(_, name, value) data[name]=value end,
      get_string=function(_, name) return data[name] or "" end}
  end,
}
local manifest = {
  world_id="world-1", origin_event_id="origin-1",
  actors={{actor_id="spaulding",name="Vincent Spaulding"}},
  public={objects={
    {id="notice",place_id="baker",position={x=0,y=1,z=0},node="society:story_notice",
      label="Dissolution notice",render_by_state={posted="society:story_notice"}},
    {id="workface",place_id="cellar",position={x=5,y=1,z=0},node="society:story_surface",
      label="Cellar workface",render_by_state={quiet="society:story_surface",
        worked="society:story_surface_disturbed"}},}},
  private_objects={
    notice={initial_state="posted",states={"posted"},reach=4,
      facets={{id="notice",state="posted",text="The League is dissolved.",
        sourceRef="docs/source-texts/sherlock-holmes/the-red-headed-league.txt#L435-L438",
        epistemic="observation"}},grants={},transitions={}},
    workface={initial_state="quiet",states={"quiet","worked"},reach=4,
      facets={{id="quiet",state="quiet",text="A marked work surface.",
        sourceRef="docs/source-texts/sherlock-holmes/the-red-headed-league.txt#L183-L186",
        epistemic="inference"},{id="worked",state="worked",text="Fresh traces.",
        sourceRef="docs/source-texts/sherlock-holmes/the-red-headed-league.txt#L183-L186",
        epistemic="author"}},grants={{actorId="spaulding",transitionIds={"continue_cellar_work"}}},
      transitions={{id="continue_cellar_work",from="quiet",to="worked"}}},
  },
}
local actor_pos={x=0,y=1,z=3}
local actor={_actor_id="spaulding",object={get_pos=function() return actor_pos end}}
local player_pos={x=0,y=1,z=1}
local function make_player(name)
  return {is_player=function() return true end,get_player_name=function() return name end,
    get_pos=function() return player_pos end}
end
local alice,bob=make_player("alice"),make_player("bob")
local runtime=story_runtime.new(engine,narrative,manifest,{logical_time=function() return 10 end,
  actor_lookup=function(id) return id=="spaulding" and actor or nil end,
  on_public_transition=function() end})
nodes["0,1,0"]={name="society:story_notice",param2=0}
assert(runtime:bind_node({object_id="notice",place_id="baker",position={x=0,y=1,z=0}}))
assert(runtime:show_object({x=0,y=1,z=0},alice))
local notice_form=forms[#forms]
assert(notice_form.name=="alice" and notice_form.form:find("L435%-L438"))
assert(runtime:handle_fields(alice,notice_form.formname,{record=true}))
assert(#narrative.player_view(runtime.state,"alice").items==1)
assert(#narrative.player_view(runtime.state,"bob").items==0)

assert(runtime:show_actor(actor,alice))
local address_form=forms[#forms]
assert(runtime:handle_fields(alice,address_form.formname,
  {send=true,message="What are you doing below the shop?"}))
assert(#chats==2 and chats[#chats].name=="alice")
local nearby_view=runtime:actor_view("spaulding","decision-1",actor_pos)
assert(#nearby_view.messages==1 and #nearby_view.granted_objects==0,
  "actor must not perceive a distant story object")
local distant_action=runtime:apply_action("spaulding","decision-1",{
  kind="continue_story_object",object_id="workface",transition_id="continue_cellar_work",
  expected_revision=0})
assert(distant_action==false)

actor_pos={x=5,y=1,z=0}
local close_view=runtime:actor_view("spaulding","decision-2",actor_pos)
assert(#close_view.granted_objects==1 and close_view.granted_objects[1].revision==0)
local reply_ok=runtime:apply_action("spaulding","decision-2",{kind="reply_player",
  conversation_id=close_view.messages[1].id,text="I was checking some photographs."})
assert(reply_ok==true and chats[#chats].name=="alice")
local before=#chats
runtime:apply_action("spaulding","decision-2",{kind="reply_player",
  conversation_id=close_view.messages[1].id,text="A forged second reply."})
assert(#chats==before)

nodes["5,1,0"]={name="society:story_surface",param2=0}
assert(runtime:bind_node({object_id="workface",place_id="cellar",position={x=5,y=1,z=0}}))
local changed,reason=runtime:apply_action("spaulding","decision-3",{
  kind="continue_story_object",object_id="workface",transition_id="continue_cellar_work",
  expected_revision=0})
assert(changed==true and reason=="world-object-changed")
assert(nodes["5,1,0"].name=="society:story_surface_disturbed")
assert(runtime:verify_node({object_id="workface",place_id="cellar",position={x=5,y=1,z=0}},
  nodes["5,1,0"]))
local snapshot=runtime:export()
local restored=story_runtime.new(engine,narrative,manifest,{logical_time=function() return 10 end})
restored:load(snapshot)
assert(restored:projected_node({object_id="workface",value={name="society:story_surface"}})
  =="society:story_surface_disturbed")
assert(restored:open_journal(alice) and forms[#forms].form:find("photographs",1,true))
assert(commands.journal and commands.wispiva_journal)
print("story_runtime: interaction, privacy, reach and map binding passed")

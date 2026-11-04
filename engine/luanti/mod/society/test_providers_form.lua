-- lua5.1 engine/luanti/mod/society/test_providers_form.lua
local form = dofile("engine/luanti/mod/society/providers_form.lua")

local function assert_true(value, message)
	if not value then error(message or "assertion failed", 2) end
end

local draft = form.empty()
form.add(draft, "alpha")
draft.providers[1].name = "SCNet"
draft.providers[1].base_url = "https://api.example/v1"
draft.providers[1].model = "glm"
draft.providers[1].api_key = "super-secret-key"
local shown = form.build(draft, "")
assert_true(not shown:find("super-secret-key", 1, true), "formspec leaked the api key")
assert_true(shown:find("pwdfield", 1, true), "missing password field")
assert_true(shown:find("SCNet", 1, true), "missing provider name")
assert_true(shown:find("style_type[label,button,field,pwdfield,dropdown,checkbox;font_size=*0.5]", 1, true), "provider form should size text relative to user settings")
assert_true(shown:find("size[16.0,12.4]", 1, true), "provider form needs room for scaled labels")
assert_true(shown:find("dropdown[0.4,1.7;9.0,0.8;which;1 SCNet;1]", 1, true), "provider selector layout")
assert_true(shown:find("label[0.4,2.65;名称]", 1, true), "name label should scale independently")
assert_true(shown:find("field[0.4,3.0;15.2,0.9;name;;", 1, true), "name field layout")
assert_true(shown:find("field[0.4,4.6;15.2,0.9;base_url;;", 1, true), "address field spacing")
assert_true(shown:find("field[0.4,6.2;15.2,0.9;model_name;;", 1, true), "model field spacing")
assert_true(shown:find("pwdfield[0.4,7.8;15.2,0.9;api_key;", 1, true), "key field spacing")
assert_true(shown:find("checkbox[0.4,9.3;current;;true]", 1, true), "checkbox label should scale independently")

local long_name = form.empty()
form.add(long_name, "long")
long_name.providers[1].name = "Long provider name"
local long_form = form.build(long_name, "")
assert_true(long_form:find("which;1 Long …;1", 1, true), "long provider names should fit the selector")
assert_true(long_form:find("name;;Long provider name", 1, true), "full provider name remains visible")

local empty_form = form.build(form.empty(), "")
assert_true(empty_form:find("size[16.0,4.0]", 1, true), "empty provider form should stay compact")
local empty_note = form.build(form.empty(), "", "zh", "local note")
assert_true(empty_note:find("size[16.0,4.8]", 1, true), "empty form note needs space")

local action = form.apply(draft, {
	which = "1 SCNet", name = " SCNet ", base_url = "https://api.example/v1",
	model_name = "glm", api_key = "", current = "true", save = "保存",
})
assert_true(action == "save", "save action")
assert_true(draft.providers[1].api_key == "super-secret-key", "blank key must stay")
assert_true(draft.selected == "alpha", "current provider")
assert_true(shown:find("field_close_on_enter[name;false]", 1, true), "enter should stay in the name field")
assert_true(shown:find("field_close_on_enter[api_key;false]", 1, true), "enter should stay in the key field")

form.apply(draft, {
	which = "1 SCNet", name = "SCNet", base_url = "https://api.example/v1",
	model_name = "glm", api_key = "", save = "保存",
})
assert_true(draft.selected == "alpha", "missing checkbox must not clear the current provider")

form.apply(draft, {
	which = "1 SCNet", name = "SCNet", base_url = "https://api.example/v1",
	model_name = "glm", api_key = "replaced-key", current = "true",
})
assert_true(draft.providers[1].api_key == "replaced-key", "typed key replaces")

form.add(draft, "beta")
assert_true(draft.index == 2, "new provider is selected in the form")
assert_true(draft.selected == "alpha", "adding does not steal the current provider")
local both = form.build(draft, form.messages.saved)
assert_true(not both:find("replaced-key", 1, true), "second form leaked the key")
assert_true(not both:find("super-secret-key", 1, true), "second form leaked the old key")

form.remove(draft)
assert_true(#draft.providers == 1 and draft.index == 1, "remove returns to the remaining provider")
form.remove(draft)
assert_true(#draft.providers == 0 and draft.index == nil, "remove last provider")
assert_true(form.apply(form.empty(), {quit = "true"}) == "quit", "quit")

local chinese = form.build(draft, "saved", "zh")
assert_true(chinese:find("模型服务", 1, true), "chinese title")
assert_true(chinese:find("中文", 1, true), "chinese language choice")
assert_true(chinese:find("已保存", 1, true), "chinese saved message")
assert_true(not chinese:find("super-secret-key", 1, true), "chinese form leaked a key")
local english = form.build(form.empty(), "", "en")
assert_true(english:find("Model service", 1, true), "english title")
assert_true(english:find("English", 1, true), "english language choice")
assert_true(english:find("Add", 1, true), "english add button")
assert_true(form.parse_language("中文") == "zh", "parse chinese")
assert_true(form.parse_language("English") == "en", "parse english")
assert_true(form.parse_language("1") == "zh", "parse index")
assert_true(form.text("en", "waiting") == "Waiting", "english waiting")
assert_true(form.text("zh", "waiting") == "等待", "chinese waiting")
assert_true(form.text(nil, "waiting") == "等待", "default language is chinese")

print("providers form ok")

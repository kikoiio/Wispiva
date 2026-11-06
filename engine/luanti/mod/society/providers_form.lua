-- In-world provider form. The api key is never copied into the formspec.
local M = {}

M.languages = {
	zh = {
		title = "模型服务",
		hint = "输入 /providers 可重新打开。",
		name = "名称",
		base_url = "接口地址",
		model = "模型",
		api_key = "密钥（已保存的留空不改）",
		current = "当前使用",
		add = "添加",
		remove = "删除",
		save = "保存并使用",
		provider_transfer_notice = "保存并启用后，每轮会向所选服务发送角色身份、目标、本人私有记忆与附近观察。",
		provider_cost_notice = "也包括你直接发给角色的私信；服务可能计费。保存即授权发送。",
		close = "关闭",
		unnamed = "未命名",
		current_mark = " · 当前",
		missing_name = "每一家都要有名称。",
		incomplete = "当前使用的一家要填写接口地址、模型和密钥。",
		bad_url = "接口地址要是 https，并且不能带账号或查询参数。",
		invalid_store = "这份配置没法保存。",
		unreadable = "原来的配置读不出来。保存会换成这个窗口里的内容。",
		unavailable = "这台服务器没有打开本机设置。",
		saved = "已保存。勾选了「当前使用」的那一家会在下一轮决策里生效。",
		language_applied = "界面语言已改为中文。暂停菜单和背包在下次打开窗口时更换。",
		waiting = "等待",
		advance = "行走",
		approach = "走近别人",
		inspect = "张望",
		mark = "放标记",
		wander = "选目的地",
		say = "说话",
		give = "递东西",
		gather = "采集",
		build = "建造",
		guide = "向导",
		guide_follow = "沿路走",
		guide_at = "在%s",
		guide_help = "跟着向导走到每个地名，然后右键牌子查看。",
		landmark_hint = "右键查看",
		read = "已读：%s",
		this_place = "这个地方",
		world_place = "世界里的一个地方。",
		place_fallback = "%s一带。",
		providers_command = "打开模型服务和语言设置",
		providers_opened = "模型服务已打开",
		providers_unavailable = "模型服务打不开",
		mark_node = "标记",
		resource_node = "资源",
		body_blocked = "这里站着人。",
		visitor_help = "你是访客，脚和这里的人站在同一层地面。WASD 移动，鼠标转向，Esc 放开鼠标。梯子内按空格上爬、Shift 下爬，松开停留。右键故事物件查看并记录线索；右键角色打开私聊；/journal 打开调查簿；/return 返回入口并保留进度。角色自主行动和回复需要模型服务；尚未配置时角色会等待。使用 /providers 前请先读服务页面的数据与费用说明。快捷栏是木材、书架、圆石、石头、石砖、砖、玻璃和火把；按 I 打开背包。",
	},
	en = {
		title = "Model service",
		hint = "Use /providers to reopen.",
		name = "Name",
		base_url = "API address",
		model = "Model",
		api_key = "Key (leave blank to keep the saved one)",
		current = "Use this one",
		add = "Add",
		remove = "Remove",
		save = "Save and use",
		provider_transfer_notice = "Saving and enabling sends each character's identity, goal, private memories, and nearby observations to the selected service.",
		provider_cost_notice = "It also sends direct messages you give that character; the service may charge you. Saving authorizes these requests.",
		close = "Close",
		unnamed = "Unnamed",
		current_mark = " · current",
		missing_name = "Every provider needs a name.",
		incomplete = "The provider in use needs an address, a model, and a key.",
		bad_url = "The address must be https, without a username or query.",
		invalid_store = "This configuration could not be saved.",
		unreadable = "The saved configuration could not be read. Saving replaces it with this window.",
		unavailable = "This server does not have local settings open.",
		saved = "Saved. The provider checked as in use takes effect on the next decision.",
		language_applied = "Language is now English. The pause menu and inventory change the next time the window opens.",
		waiting = "Waiting",
		advance = "Walking",
		approach = "Approaching another agent",
		inspect = "Looking around",
		mark = "Placing a marker",
		wander = "Choosing a destination",
		say = "Sending a message",
		give = "Handing over a resource",
		gather = "Gathering",
		build = "Building",
		guide = "Wispiva guide",
		guide_follow = "Follow the route",
		guide_at = "At %s",
		guide_help = "Follow the guide to each named place, then right-click a landmark to inspect it.",
		landmark_hint = "Right-click to inspect",
		read = "Read: %s",
		this_place = "this place",
		world_place = "A place in the world.",
		place_fallback = "The %s area.",
		providers_command = "Open model and language settings",
		providers_opened = "Model settings are open",
		providers_unavailable = "Model settings could not be opened",
		mark_node = "Marker",
		resource_node = "Resource",
		body_blocked = "A character is standing here.",
		visitor_help = "You are a visitor, standing on the same ground as the characters. WASD moves, the mouse looks, and Esc frees the mouse. On ladders, Space climbs up, Shift climbs down, and releasing the keys holds position. Right-click a story object to inspect and record a clue; right-click a character to send a private message; use /journal to review your notebook, or /return to return to the entrance while keeping progress. Autonomous actions and replies need a model service; without one, characters wait. Read the data and cost notice in /providers before enabling a service. The hotbar holds wood, bookshelves, cobble, stone, stone brick, brick, glass, and torches; press I for the inventory.",
	},
}

-- Existing callers and tests read the Chinese messages by code.
M.messages = M.languages.zh

function M.normalize_language(code)
	if code == "en" then return "en" end
	return "zh"
end

function M.text(lang, key)
	local pack = M.languages[M.normalize_language(lang)]
	local value = pack[key]
	if value == nil then value = M.languages.zh[key] end
	if value == nil then return tostring(key) end
	return value
end

function M.parse_language(value)
	if type(value) ~= "string" then return nil end
	if value:find("中文", 1, true) or value == "zh" or value == "1" then return "zh" end
	if value:find("English", 1, true) or value == "en" or value == "2" then return "en" end
	return nil
end

local function escape(text)
	text = tostring(text or "")
	text = text:gsub("\\", "\\\\")
	text = text:gsub("%]", "\\]")
	text = text:gsub("%[", "\\[")
	text = text:gsub(";", "\\;")
	text = text:gsub(",", "\\,")
	text = text:gsub("%$", "\\$")
	return text
end

local function trim(value)
	if type(value) ~= "string" then return "" end
	return (value:gsub("^%s+", ""):gsub("%s+$", ""))
end

function M.empty()
	return {selected = nil, providers = {}, index = nil}
end

function M.normalize(draft)
	if type(draft) ~= "table" or type(draft.providers) ~= "table" then return M.empty() end
	local index = nil
	for i, item in ipairs(draft.providers) do
		if type(item) == "table" and draft.selected ~= nil and item.id == draft.selected then
			index = i
		end
	end
	if not index and #draft.providers > 0 then index = 1 end
	draft.index = index
	return draft
end

function M.add(draft, id)
	draft.providers[#draft.providers + 1] = {
		id = id, name = "", base_url = "", model = "", api_key = "",
	}
	draft.index = #draft.providers
	if draft.selected == nil or draft.selected == "" then draft.selected = id end
end

function M.remove(draft)
	local index = draft.index
	local item = index and draft.providers[index] or nil
	if not item then return end
	table.remove(draft.providers, index)
	if draft.selected == item.id then draft.selected = nil end
	if #draft.providers == 0 then
		draft.index = nil
	else
		draft.index = math.min(index, #draft.providers)
	end
end

function M.apply(draft, fields)
	if type(fields) ~= "table" then return "invalid" end
	if fields.quit and not fields.save and not fields.add and not fields.remove then
		return "quit"
	end
	local index = nil
	if type(fields.which) == "string" then index = tonumber(fields.which:match("^(%d+)")) end
	local item = index and draft.providers[index] or nil
	if item then
		item.name = trim(fields.name):gsub("[%c]", "")
		item.base_url = trim(fields.base_url):gsub("[%c]", "")
		item.model = trim(fields.model_name):gsub("[%c]", "")
		if type(fields.api_key) == "string" and fields.api_key ~= "" then
			item.api_key = fields.api_key
		end
		if fields.current == "true" then
			draft.selected = item.id
		elseif fields.current == "false" and draft.selected == item.id then
			draft.selected = nil
		end
		draft.index = index
	end
	if fields.add then return "add" end
	if fields.remove then return "remove" end
	if fields.save then return "save" end
	return "refresh"
end

local function short_name(value, limit)
	local byte, count = 1, 0
	while byte <= #value and count < limit do
		local first = value:byte(byte)
		local width = first >= 240 and 4 or first >= 224 and 3 or first >= 192 and 2 or 1
		if byte + width - 1 > #value then width = 1 end
		byte = byte + width
		count = count + 1
	end
	local prefix = value:sub(1, byte - 1)
	if byte <= #value then prefix = prefix .. "…" end
	return prefix
end

local function option(index, item, lang)
	local name = item.name ~= "" and item.name or M.text(lang, "unnamed")
	return escape(tostring(index) .. " " .. short_name(name, 5))
end

local function language_dropdown(lang)
	local index = lang == "en" and 2 or 1
	return string.format("dropdown[10.2,0.15;5.4,0.7;language;%s,%s;%d]",
		escape("中文"), escape("English"), index)
end

function M.build(draft, status, lang, note)
	lang = M.normalize_language(lang)
	if type(status) == "string" and status:match("^[%a_]+$") and M.languages.zh[status] then
		status = M.text(lang, status)
	end
	local item = draft.index and draft.providers[draft.index] or nil
	local height = item and (note and note ~= "" and 14.8 or 14.0)
		or (note and note ~= "" and 4.8 or 4.0)
	local status_y = item and 13.0 or 3.0
	local note_y = item and 13.8 or 3.8
	local lines = {
		"formspec_version[6]",
		string.format("size[16.0,%.1f]", height),
		"style_type[label,button,field,pwdfield,dropdown,checkbox;font_size=*0.5]",
		"label[0.4,0.55;" .. escape(M.text(lang, "title")) .. "]",
		language_dropdown(lang),
		"label[0.4,1.05;" .. escape(M.text(lang, "hint")) .. "]",
	}
	if not item then
		lines[#lines + 1] = string.format("button[0.4,1.7;2.4,0.8;add;%s]", escape(M.text(lang, "add")))
		lines[#lines + 1] = string.format("button[3.0,1.7;2.4,0.8;quit;%s]", escape(M.text(lang, "close")))
	else
		local options = {}
		for i, provider in ipairs(draft.providers) do
			options[#options + 1] = option(i, provider, draft.selected, lang)
		end
		lines[#lines + 1] = string.format(
			"dropdown[0.4,1.7;9.0,0.8;which;%s;%d]",
			table.concat(options, ","), draft.index)
		lines[#lines + 1] = string.format("button[9.6,1.7;2,0.8;add;%s]", escape(M.text(lang, "add")))
		lines[#lines + 1] = string.format("button[11.8,1.7;2.2,0.8;remove;%s]", escape(M.text(lang, "remove")))
		lines[#lines + 1] = "label[0.4,2.65;" .. escape(M.text(lang, "name")) .. "]"
		lines[#lines + 1] = string.format(
			"field[0.4,3.0;15.2,0.9;name;;%s]", escape(item.name))
		lines[#lines + 1] = "label[0.4,4.15;" .. escape(M.text(lang, "base_url")) .. "]"
		lines[#lines + 1] = string.format(
			"field[0.4,4.6;15.2,0.9;base_url;;%s]", escape(item.base_url))
		lines[#lines + 1] = "label[0.4,5.75;" .. escape(M.text(lang, "model")) .. "]"
		lines[#lines + 1] = string.format(
			"field[0.4,6.2;15.2,0.9;model_name;;%s]", escape(item.model))
		lines[#lines + 1] = "label[0.4,7.35;" .. escape(M.text(lang, "api_key")) .. "]"
		lines[#lines + 1] = string.format(
			"pwdfield[0.4,7.8;15.2,0.9;api_key;]")
		lines[#lines + 1] = "field_close_on_enter[name;false]"
		lines[#lines + 1] = "field_close_on_enter[base_url;false]"
		lines[#lines + 1] = "field_close_on_enter[model_name;false]"
		lines[#lines + 1] = "field_close_on_enter[api_key;false]"
		lines[#lines + 1] = "checkbox[0.4,9.3;current;;" ..
			(item.id == draft.selected and "true" or "false") .. "]"
		lines[#lines + 1] = "label[1.4,9.65;" .. escape(M.text(lang, "current")) .. "]"
		lines[#lines + 1] = "label[0.4,10.2;" .. escape(M.text(lang, "provider_transfer_notice")) .. "]"
		lines[#lines + 1] = "label[0.4,10.65;" .. escape(M.text(lang, "provider_cost_notice")) .. "]"
		lines[#lines + 1] = string.format("button[10.4,11.3;2.6,0.8;save;%s]", escape(M.text(lang, "save")))
		lines[#lines + 1] = string.format("button[13.2,11.3;2.4,0.8;quit;%s]", escape(M.text(lang, "close")))
	end
	if status and status ~= "" then
		lines[#lines + 1] = string.format("label[0.4,%.1f;%s]", status_y, escape(status))
	end
	if note and note ~= "" then
		lines[#lines + 1] = string.format("label[0.4,%.1f;%s]", note_y, escape(note))
	end
	return table.concat(lines, "")
end

return M

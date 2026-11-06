local M = {}

function M.install(engine, operations)
  local protected = {}
  local function key(p) return p.x .. "," .. p.y .. "," .. p.z end
  for _, operation in ipairs(operations) do
    if operation.kind == "node" and not operation.terrain then protected[key(operation.position)] = true end
  end
  local previous = engine.is_protected
  engine.is_protected = function(position, name)
    if protected[key(position)] then return true end
    return previous and previous(position, name) or false
  end
  if engine.register_on_protection_violation then
    engine.register_on_protection_violation(function(position, name)
      if protected[key(position)] then
        engine.chat_send_player(name, "[Wispiva] 这里的场景物件不能直接挖掘或覆盖。请右键调查，或与角色交谈。")
      end
    end)
  end
end

return M

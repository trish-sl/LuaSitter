--[[
  LSadjuster - AVsitter1-style helper-mode adjuster and [NEW] pose creator
  LuaSitter: SLua port of AVsitter(TM) AVadjuster (AVsitter1). Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  Optional, one per linkset (replaces AVsitter1 "AVadjuster"). Rezzes the
  helper objects ("LShelper", falling back to "AVhelper", each containing
  LShelper-script) for [HELPER] mode, saves helper positions back to the
  LSsit scripts ([SAVE] -> 90090), and runs the [NEW] menu (create POSE,
  SYNC, SUBMENU -> 90170).
  If another adjuster starts in the linkset, the older one deletes itself.
  Saying "cleanup" on channel 5 (owner) removes the helper objects and this
  script from the prim.

  Not merged into LSsit: it is optional, single per linkset (LSsit is one
  per sitter and per prim) and removes itself on "cleanup".

  Behaviour changes
  -----------------
  - Animation lists for [POSE]/[SYNC] are paged over the real inventory.
  - Missing helper object: reports an error instead of an LSL script error.
  - FIX: typing an empty name for a new POSE/SYNC opened the menu twice.
]]

local HELPER_NAMES = { "LShelper", "AVhelper" }
-- Pose notecard: "LSpos" (LuaSitter name) is used when present, else "AVpos" (AVsitter name).
-- posCard(n) gives the name of sitter n's own notecard: "LSpos sitter N".
local function posCard(n: number?): string
    if n then
        -- per-sitter notecard: never "LSpos 1", the name Second Life gives a duplicate copy
        return "LSpos sitter " .. tostring(n)
    end
    if ll.GetInventoryType("LSpos") ~= INVENTORY_NOTECARD and ll.GetInventoryType("AVpos") == INVENTORY_NOTECARD then
        return "AVpos"
    end
    return "LSpos"
end
-- name and key of the current pose notecard: changes when it is edited, added, or renamed
local function posCardSig(): string
    local name = posCard()
    return name .. tostring(ll.GetInventoryKey(name))
end
local NULL = tostring(NULL_KEY)
local number_per_page = 9

--------------------------------------------------------------------------
-- helpers
--------------------------------------------------------------------------
local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

local function int(v: any): number
    if type(v) == "number" then
        return if v >= 0 then math.floor(v) else math.ceil(v)
    end
    local s = tostring(v or "")
    local sign, hex = string.match(s, "^%s*([-+]?)0[xX](%x+)")
    if hex then
        local n = tonumber(hex, 16) or 0
        return if sign == "-" then -n else n
    end
    return tonumber(string.match(s, "^%s*([-+]?%d+)")) or 0
end

local function num(v: any): number
    if type(v) == "number" then
        return v
    end
    local s = tostring(v or "")
    return tonumber(string.match(s, "^%s*([-+]?%d*%.?%d+[eE][-+]?%d+)") or string.match(s, "^%s*([-+]?%d*%.?%d+)") or "") or 0
end

local function lslVec(s: string): vector
    local a, b, c = string.match(s, "^%s*<([^,]*),([^,]*),([^,>]*)")
    if not a then
        return ZERO_VECTOR
    end
    return vector(num(a), num(b), num(c))
end

local function fmtV(v: vector): string
    return string.format("<%.5f, %.5f, %.5f>", v.x, v.y, v.z)
end
local function fmtR(r: quaternion): string
    return string.format("<%.5f, %.5f, %.5f, %.5f>", r.x, r.y, r.z, r.s)
end

local function L(t: { any }, i: number): string
    if i < 0 then
        i = #t + 1 + i
    end
    local v = t[i]
    if v == nil then
        return ""
    end
    return tostring(v)
end

local function replace(s: string, search: string, rep: string): string
    return ll.ReplaceSubString(s, search, rep, 0)
end

local function orderButtons(b: { string }): { string }
    local out = {}
    local n = #b
    for _, r in { { n - 2, n }, { n - 5, n - 3 }, { n - 8, n - 6 }, { n - 11, n - 9 } } do
        for i = math.max(r[1], 1), r[2] do
            if i >= 1 then
                table.insert(out, b[i])
            end
        end
    end
    return out
end

local function owner(): string
    return tostring(ll.GetOwner())
end

local function Owner_Say(say: string)
    print(ll.GetScriptName() .. ": " .. say)
end

-- helper object to rez: "LShelper", else "AVhelper"
local function helper_name(): string?
    for _, n in HELPER_NAMES do
        if ll.GetInventoryType(n) == INVENTORY_OBJECT then
            return n
        end
    end
    return nil
end

--------------------------------------------------------------------------
-- state (per-sitter tables are indexed by sitter number + 1)
--------------------------------------------------------------------------
local notecard_key = ""
local active_link = 0
local active_sitter = 0
local pose_name = ""
local total_scripts = 0
local HELPER_KEY_LIST: { string } = {}
local HELPER_AV_LIST: { string } = {}
local INVOLVED: { number } = {}
local HELPER_POS_ROT: { string } = {}
local HELPERS_REZZED: { boolean } = {}
local adding = ""
local last_text = ""
local choice_page = 0
local choice_pages = 0
local chosen_animation = ""
local chosen_animation2 = ""
local dont_move = false
local comm_channel = 0

local function setAt(t: { any }, i: number, v: any)
    if i >= 0 and i < #t then
        t[i + 1] = v
    end
end

local function resetPosRot()
    HELPER_POS_ROT = {}
    INVOLVED = {}
    for _ = 1, total_scripts do
        table.insert(HELPER_POS_ROT, "~")
        table.insert(INVOLVED, 0)
    end
end

local function clean_avhelper()
    local i = 1
    while i <= ll.GetInventoryNumber(INVENTORY_OBJECT) do
        local n = ll.GetInventoryName(INVENTORY_OBJECT, i)
        local isHelper = false
        for _, h in HELPER_NAMES do
            if string.sub(n, 1, #h) == h then
                isHelper = true
            end
        end
        if isHelper then
            print("Cleaning \"" .. n .. "\" from prim " .. ll.GetLinkNumber())
            ll.RemoveInventory(n)
        else
            i += 1
        end
    end
end

local function convert_to_world_positions(n: number): string
    local details = ll.GetObjectDetails(ll.GetLinkKey(active_link), { OBJECT_POS, OBJECT_ROT })
    local linkpos = (details[1] or ZERO_VECTOR) :: vector
    local linkrot = (details[2] or ZERO_ROTATION) :: quaternion
    local p = ll.ParseStringKeepNulls(HELPER_POS_ROT[n + 1] or "", { "|" }, {})
    local target_rot = ll.Euler2Rot(lslVec(L(p, 2)) * DEG_TO_RAD) * linkrot
    local target_pos = lslVec(L(p, 1)) * linkrot + linkpos
    return fmtV(target_pos) .. "|" .. fmtR(target_rot)
end

local function calc_sit_target(script: number, target: string)
    local mine = ll.GetObjectDetails(ll.GetLinkKey(active_link), { OBJECT_POS, OBJECT_ROT })
    local theirs = ll.GetObjectDetails(K(target), { OBJECT_POS, OBJECT_ROT })
    if theirs[1] ~= nil and theirs[1] ~= ZERO_VECTOR and mine[2] ~= nil then
        local f = mine[2] :: quaternion
        local target_rot = (theirs[2] :: quaternion) / f
        local target_pos = ((theirs[1] :: vector) - (mine[1] :: vector)) / f
        local posrot = fmtV(target_pos) .. "|" .. fmtV(ll.Rot2Euler(target_rot) * RAD_TO_DEG)
        ll.MessageLinked(active_link, 90090, tostring(script), posrot)
        setAt(HELPER_POS_ROT, script, posrot)
        ll.RegionSay(comm_channel, "POS|" .. script .. "|" .. convert_to_world_positions(script))
    end
end

local function new_menu()
    ll.Dialog(ll.GetOwner(), "\nWhat would you like to create?:", orderButtons({ "[BACK]", "~", "~", "[POSE]", "[SYNC]", "[SUBMENU]" }), comm_channel)
end

local function choice_menu(options: { string }, text: string)
    last_text = text
    local menu_text = "\n" .. text .. "\n\n"
    local menu_items: { string } = {}
    if #options == 0 then
        menu_text = "\nNo animations in the prim inventory."
        menu_items = { "[BACK]" }
    else
        for i, o in options do
            table.insert(menu_items, tostring(i))
            menu_text ..= i .. "." .. o .. "\n"
        end
        while #menu_items < number_per_page do
            table.insert(menu_items, "~")
        end
        for _, b in { "[BACK]", "[PAGE-]", "[PAGE+]" } do
            table.insert(menu_items, b)
        end
    end
    ll.Dialog(ll.GetOwner(), menu_text, orderButtons(menu_items), comm_channel)
end

local function get_contents(itype: number, newpage: number): { string }
    choice_page = newpage
    local names: { string } = {}
    for i = 1, ll.GetInventoryNumber(itype) do
        local n = ll.GetInventoryName(itype, i)
        if itype ~= INVENTORY_OBJECT or not table.find(HELPER_NAMES, n) then
            table.insert(names, n)
        end
    end
    choice_pages = #names // number_per_page
    local contents = {}
    for i = number_per_page * choice_page + 1, number_per_page * choice_page + number_per_page do
        if names[i] then
            table.insert(contents, names[i])
        end
    end
    return contents
end

local function setActiveLink(sender: number)
    active_link = sender
    if ll.GetNumberOfPrims() == 1 then
        active_link = 0
    end
end

--------------------------------------------------------------------------
-- events
--------------------------------------------------------------------------
LLEvents:on("changed", function(change: number)
    if bit32.btest(change, CHANGED_LINK) then
        if helper_name() then
            ll.MessageLinked(LINK_SET, 90085, "", NULL)
        end
    elseif bit32.btest(change, CHANGED_INVENTORY) then
        local k = posCardSig()
        if k ~= notecard_key then
            ll.RegionSay(comm_channel, "DONEA")
            notecard_key = k
        end
    end
end)

LLEvents:on("link_message", function(sender: number, num_: number, msg: string, id: string)
    if num_ == 90030 then
        local a = int(msg)
        local b = int(id)
        setAt(HELPER_AV_LIST, a, NULL)
        setAt(HELPER_AV_LIST, b, NULL)
        if a >= 0 and a < #HELPERS_REZZED and b >= 0 and b < #HELPERS_REZZED then
            HELPERS_REZZED[a + 1], HELPERS_REZZED[b + 1] = HELPERS_REZZED[b + 1], HELPERS_REZZED[a + 1]
        end
        ll.RegionSay(comm_channel, "SWAP|" .. a .. "|" .. b)
    elseif num_ == 90010 then
        for i = 0, #HELPER_AV_LIST - 1 do
            if HELPERS_REZZED[i + 1] then
                if HELPER_AV_LIST[i + 1] ~= NULL then
                    calc_sit_target(i, HELPER_AV_LIST[i + 1])
                else
                    calc_sit_target(i, HELPER_KEY_LIST[i + 1] or NULL)
                end
            end
        end
        local kind = "POSE '" .. pose_name
        if string.sub(pose_name, 1, 2) == "S:" then
            kind = "SYNC '" .. string.sub(pose_name, 3)
        end
        ll.Say(0, kind .. "' saved to memory.")
    elseif num_ == 90060 then
        ll.RegionSay(comm_channel, "DONEA")
    elseif num_ == 90040 then
        setActiveLink(sender)
        local data = ll.ParseString2List(msg, { "|" }, {})
        total_scripts = int(L(data, 2))
        resetPosRot()
        active_sitter = int(L(data, 1))
        ll.MessageLinked(active_link, 90110, tostring(active_sitter), "")
    elseif num_ == 90100 then
        ll.RegionSay(comm_channel, "DONEA")
        local i = ll.GetNumberOfPrims()
        while ll.GetAgentSize(ll.GetLinkKey(i)) ~= ZERO_VECTOR do
            ll.UnSit(ll.GetLinkKey(i))
            i -= 1
        end
        setActiveLink(sender)
        local data = ll.ParseString2List(msg, { "|" }, {})
        total_scripts = int(L(data, 2))
        HELPER_KEY_LIST = {}
        HELPER_AV_LIST = {}
        HELPERS_REZZED = {}
        for _ = 1, total_scripts do
            table.insert(HELPER_KEY_LIST, NULL)
            table.insert(HELPER_AV_LIST, NULL)
            table.insert(HELPERS_REZZED, false)
        end
        resetPosRot()
        active_sitter = int(L(data, 1))
        ll.MessageLinked(active_link, 90110, tostring(active_sitter), "")
    elseif num_ == 90070 and sender == active_link then
        setAt(HELPER_AV_LIST, int(msg), id)
    elseif num_ == 90130 then
        local data = ll.ParseString2List(msg, { ">" }, {})
        local sending_script = int(id)
        setAt(HELPER_POS_ROT, sending_script, L(data, 1) .. ">" .. "|" .. L(data, 2) .. ">")
        setAt(INVOLVED, sending_script, int(L(data, 3)))
        if not table.find(HELPER_POS_ROT, "~") then
            for i = 0, #HELPERS_REZZED - 1 do
                if (INVOLVED[i + 1] or 0) ~= 0 then
                    if not HELPERS_REZZED[i + 1] then
                        local h = helper_name()
                        if h then
                            ll.RezObject(h, ll.GetPos(), ZERO_VECTOR, ll.GetRot(), comm_channel + i * -1)
                        else
                            Owner_Say("Error: no LShelper (or AVhelper) object in this prim")
                        end
                        HELPERS_REZZED[i + 1] = true
                    elseif not dont_move then
                        ll.RegionSay(comm_channel, "POS|" .. i .. "|" .. convert_to_world_positions(i))
                    end
                elseif HELPERS_REZZED[i + 1] then
                    if HELPER_AV_LIST[i + 1] ~= NULL then
                        HELPER_AV_LIST[i + 1] = NULL
                        ll.MessageLinked(LINK_THIS, 90075, tostring(i), NULL)
                    end
                    HELPERS_REZZED[i + 1] = false
                    ll.RegionSay(comm_channel, "DONE|" .. i)
                end
            end
            dont_move = false
        end
    end
    -- second, independent chain (as in AVsitter1)
    if num_ == 90160 then
        if id == owner() then
            active_sitter = int(msg)
            if sender == ll.GetLinkNumber() then
                adding = ""
                new_menu()
            else
                ll.InstantMessage(K(id), "Sorry, the [NEW] menu is only available if your LSadjuster and LShelper are in the same prim as your LSsit.")
            end
        else
            ll.InstantMessage(K(id), "Sorry, the [NEW] menu is for owner only.")
        end
    elseif msg == "Adjuster-Check" and num_ ~= comm_channel then
        -- a newer adjuster started in the linkset: this one removes itself
        clean_avhelper()
        print("Deleting \"" .. ll.GetScriptName() .. "\" from prim " .. ll.GetLinkNumber())
        print("Please place only one Adjuster in your linkset!")
        ll.RemoveInventory(ll.GetScriptName())
    elseif num_ == 90045 then
        pose_name = L(ll.ParseStringKeepNulls(msg, { "|" }, {}), 1)
    end
end)

LLEvents:on("listen", function(chan: number, _name: string, uid: uuid, message: string)
    local id = tostring(uid)
    if chan == 5 then
        ll.RegionSay(comm_channel, "DONEA")
        clean_avhelper()
        print("Cleaning \"" .. ll.GetScriptName() .. "\" from prim " .. ll.GetLinkNumber())
        ll.RemoveInventory(ll.GetScriptName())
    elseif id == owner() then
        if message == "[PAGE+]" then
            choice_page += 1
            if choice_page > choice_pages then
                choice_page = 0
            end
            choice_menu(get_contents(INVENTORY_ANIMATION, choice_page), last_text)
        elseif message == "[PAGE-]" then
            choice_page -= 1
            if choice_page < 0 then
                choice_page = choice_pages
            end
            choice_menu(get_contents(INVENTORY_ANIMATION, choice_page), last_text)
        elseif message == "[BACK]" then
            ll.MessageLinked(LINK_SET, 90005, "", id)
        elseif message == "[POSE]" then
            adding = message
            choice_menu(get_contents(INVENTORY_ANIMATION, 0), "Please choose your animation:")
        elseif message == "[SYNC]" then
            if total_scripts < 2 then
                Owner_Say("To create a SYNC via menu requires 2 LSsit scripts in the prim!")
                new_menu()
            else
                adding = message
                choice_menu(get_contents(INVENTORY_ANIMATION, 0), "Please choose your first animation:")
            end
        elseif message == "[SUBMENU]" then
            adding = message
            ll.TextBox(ll.GetOwner(), "\n\nPlease type a name for your submenu:", comm_channel)
        elseif table.find({ "1", "2", "3", "4", "5", "6", "7", "8", "9" }, message)
            and (adding == "[POSE]" or adding == "[SYNC]" or adding == "[SYNC]2")
        then
            local anim = L(get_contents(INVENTORY_ANIMATION, choice_page), int(message))
            if adding == "[POSE]" then
                adding = "[POSE]2"
                chosen_animation = anim
                ll.TextBox(ll.GetOwner(), "\n\nPlease type a menu name for pose\n\nAnimation: " .. chosen_animation, comm_channel)
            elseif adding == "[SYNC]2" then
                adding = "[SYNC]3"
                chosen_animation2 = anim
                ll.TextBox(ll.GetOwner(), "\n\nPlease type a menu name for sync\n\nAnimation1: " .. chosen_animation .. "\nAnimation2: " .. chosen_animation2, comm_channel)
            elseif adding == "[SYNC]" then
                adding = "[SYNC]2"
                chosen_animation = anim
                choice_menu(get_contents(INVENTORY_ANIMATION, 0), "Please choose your second animation:")
            end
        else
            message = replace(message, "\n", "")
            message = replace(message, "|", "")
            message = ll.GetSubString(message, 1, 23)
            if message == "" then
                ll.MessageLinked(LINK_SET, 90005, "", id)
            elseif adding == "[SUBMENU]" then
                ll.MessageLinked(active_link, 90170, tostring(active_sitter), "T:" .. message .. "*|")
                ll.MessageLinked(active_link, 90170, tostring(active_sitter), "M:" .. message .. "*|")
                Owner_Say("Created submenu '" .. message .. "' in SITTER " .. active_sitter)
                ll.MessageLinked(LINK_SET, 90005, "", id)
            elseif adding == "[POSE]2" then
                ll.MessageLinked(active_link, 90170, tostring(active_sitter), message .. "|" .. chosen_animation)
                ll.MessageLinked(active_link, 90110, tostring(active_sitter), "")
                ll.Say(0, "Added POSE '" .. message .. "' using anim '" .. chosen_animation .. "' in SITTER " .. active_sitter)
                dont_move = true
            elseif adding == "[SYNC]3" then
                message = "S:" .. message
                ll.MessageLinked(active_link, 90170, "0", message .. "|" .. chosen_animation)
                ll.MessageLinked(active_link, 90170, "1", message .. "|" .. chosen_animation2)
                ll.MessageLinked(active_link, 90110, tostring(active_sitter), "")
                ll.Say(0, "Added SYNC '" .. string.sub(message, 3) .. "' using anms '" .. chosen_animation .. "' and '" .. chosen_animation2 .. "'")
                dont_move = true
            end
            -- FIX: an empty name no longer opens the menu twice
            if message ~= "" and (adding == "[POSE]2" or adding == "[SYNC]3") then
                ll.MessageLinked(LINK_SET, 90005, "", id)
                resetPosRot()
            end
        end
    elseif tostring(ll.GetOwnerKey(uid)) == owner() then
        -- messages from the helper objects
        local data = ll.ParseString2List(message, { "|" }, {})
        local n = int(L(data, 2))
        local cmd = L(data, 1)
        if cmd == "REG" then
            setAt(HELPER_KEY_LIST, n, id)
            ll.RegionSay(comm_channel, "POS|" .. n .. "|" .. convert_to_world_positions(n))
        elseif cmd == "ANIMA" then
            local av = L(data, 3)
            for i = 0, #HELPER_AV_LIST - 1 do
                if HELPER_AV_LIST[i + 1] == av then
                    HELPER_AV_LIST[i + 1] = NULL
                    ll.MessageLinked(LINK_SET, 90075, tostring(i), NULL)
                end
            end
            ll.MessageLinked(active_link, 90050, L(data, 2), av)
        elseif cmd == "GETUP" then
            setAt(HELPER_AV_LIST, n, NULL)
            ll.MessageLinked(LINK_SET, 90075, tostring(n), NULL)
        elseif cmd == "MENU" then
            ll.MessageLinked(LINK_SET, 90005, "3", L(data, 3))
        end
    end
end)

LLEvents:on("on_rez", function(_x: number)
    ll.ResetScript()
end)

--------------------------------------------------------------------------
-- init (state_entry)
--------------------------------------------------------------------------
notecard_key = posCardSig()
comm_channel = -((math.floor(ll.Frand(999999)) + 1) * 1000)
ll.MessageLinked(LINK_SET, comm_channel, "Adjuster-Check", NULL)
ll.Listen(comm_channel, "", NULL_KEY, "")
ll.Listen(5, "", ll.GetOwner(), "cleanup")

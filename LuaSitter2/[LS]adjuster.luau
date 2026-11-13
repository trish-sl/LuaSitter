--[[
  [LS]adjuster - Create a setup and an LSpos (or AVpos) notecard from scratch
  LuaSitter: SLua port of AVsitter(TM) [AV]adjuster. Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  Lives in the same prim as the [LS]sit scripts. Provides the adjust tools:
    - [NEW] menu: create POSE / SYNC / SUBMENU / PROP / FACE / CAMERA entries.
    - [SAVE]: push the current positions of all sitters to the sit memory.
    - [HELPER]: rez helper objects ("[LS]helper", or legacy "[AV]helper") that
      move poses when moved. Chat protocol with the helper is unchanged, so old
      [AV]helper objects keep working.
    - [DUMP]: print the LSpos notecard text to the owner in chat.

  Changes compared to [AV]adjuster
    - Script names: [AV]sitA -> [LS]sit, [AV]prop -> [LS]plugins (props, merged
      with sequence and favs), [AV]faces + [AV]camera -> [LS]faces-camera.
    - The DUMP chain asks [LS]plugins, [LS]faces-camera and [LS]root-RLV.
    - Says a notice on every rez/start (and shows one in the [NEW] menu) that this
      is a setup tool the creator can delete before the furniture is sold or
      given away. It may stay: a customer who owns it is told they can use it.
    - The DUMP chain also asks [LS]root-RLV (issue #18) after the camera plugin.
    - The "V:" dump line carries extra fields (KFM, LROT, DFLT, WARN, BRAND,
      ROLES, ONSIT) that upstream never dumped (data loss on re-dump). They are
      now written in the header. Missing fields (old sitter scripts) = defaults.
    - Header line reads "LuaSitter <version>".
    - New link message 90032 (swap sitters and return the menu, issue #140) is
      handled exactly like 90030.
    - DUMP goes to chat only. The upstream web "Settings copy" (avsitter.com /
      php/settings.php) was removed: LuaSitter does not use a dump server.
    - FormatFloat rewritten with string.format (same output as upstream).
]]

local VERSION = "3.0-lua1"

--------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------
local SEP = "\u{FFFD}"
local NULL = tostring(NULL_KEY)

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

-- Character count (ll.StringLength is deprecated; # counts bytes, utf8.len counts characters).
local function charLen(s: string): number
    return utf8.len(s) or #s
end

local function K(s: string?): uuid
    return touuid(s or "") or NULL_KEY
end

local function isKey(s: string?): boolean
    return s ~= nil and s ~= "" and s ~= NULL and touuid(s) ~= nil
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

local function vec(s: any): vector
    if typeof(s) == "vector" then
        return s
    end
    return tovector(tostring(s or "")) or ZERO_VECTOR
end

local function rot(s: any): quaternion
    if typeof(s) == "quaternion" then
        return s
    end
    return torotation(tostring(s or "")) or ZERO_ROTATION
end

local function L(t: {any}, i: number): string
    if i < 0 then
        i = #t + 1 + i
    end
    local v = t[i]
    if v == nil then
        return ""
    end
    return tostring(v)
end

local function startsWith(s: string, p: string): boolean
    return string.sub(s, 1, #p) == p
end

local function replace(s: string, search: string, rep: string): string
    return ll.ReplaceSubString(s, search, rep, 0)
end

local function split(s: string, sep: string): {string}
    return ll.ParseStringKeepNulls(s, {sep}, {})
end

local function orderButtons(b: {string}): {string}
    local out = {}
    local n = #b
    for _, r in { {n - 2, n}, {n - 5, n - 3}, {n - 8, n - 6}, {n - 11, n - 9} } do
        for i = math.max(r[1], 1), r[2] do
            if i >= 1 then
                table.insert(out, b[i])
            end
        end
    end
    return out
end

-- LSL (string)vector / (string)rotation format (5 decimals)
local function lslVec(v: vector): string
    return string.format("<%.5f, %.5f, %.5f>", v.x, v.y, v.z)
end

local function lslRot(r: quaternion): string
    return string.format("<%.5f, %.5f, %.5f, %.5f>", r.x, r.y, r.z, r.s)
end

-- round a number to single precision (LSL floats are 32-bit; SLua vectors too)
local function f32(x: number): number
    return vector(x, 0, 0).x
end

-- Same output as upstream FormatFloat: round half away from zero to
-- num_decimals, then strip trailing zeros and a trailing ".". Upstream did
-- f += sign(f) * (0.5e-n - 0.5e-6), then (string)f (6 decimals) and cut.
-- Note: an exact -0.0 becomes +0 through the "+= 0" (prints "0"), while a
-- tiny negative value like -0.0001 prints "-0", exactly like upstream.
local function FormatFloat(f: number, num_decimals: number): string
    local sign = (if f > 0 then 1 else 0) - (if f < 0 then 1 else 0)
    local adj = f32(f32(0.5 * 10 ^ -num_decimals) - f32(0.5e-6))
    f = f32(f + sign * adj)
    local s = string.format("%.6f", f)
    local ret
    if num_decimals == 0 then
        ret = string.sub(s, 1, #s - 7)
    else
        ret = string.sub(s, 1, #s - 6 + num_decimals)
        ret = (string.gsub(ret, "0+$", ""))
        ret = (string.gsub(ret, "%.$", ""))
    end
    return ret
end

--------------------------------------------------------------------------
-- Names
--------------------------------------------------------------------------
local helper_names = { "[LS]helper", "[AV]helper" }
local prop_script = "[LS]plugins"            -- props (together with sequence and favs)
local expression_script = "[LS]faces-camera" -- facial expressions and cameras
local camera_script = expression_script
local rlv_script = "[LS]root-RLV"
local main_script = "[LS]sit"

-- Helper object to rez: prefer [LS]helper, fall back to legacy [AV]helper
local function helperName(): string
    for _, n in helper_names do
        if ll.GetInventoryType(n) == INVENTORY_OBJECT then
            return n
        end
    end
    return helper_names[1]
end

local function isHelperName(n: string): boolean
    return table.find(helper_names, n) ~= nil
end

--------------------------------------------------------------------------
-- State (sitter tables are 1-based: sitter # n is at index n + 1)
--------------------------------------------------------------------------
local OLD_HELPER_METHOD = 0
local POS_LIST: {vector} = {}
local ROT_LIST: {vector} = {}
local HELPER_KEY_LIST: {string} = {}
local SITTER_POSES: {string} = {}
local SITTERS: {string} = {}
local sitter_count = 0
local end_count = 0
local chat_channel = 5
local helper_mode = false
local comm_channel = 0
local active_sitter = 0
local controller = NULL
local menu_page = 0
local adding = ""
local last_text = ""
local menu_pages = 0
local number_per_page = 9
local chosen_animations: {string} = {}

local function owner(): string
    return tostring(ll.GetOwner())
end

-- set sitter table entry by 0-based sitter number (ignores out of range)
local function setAt(t: {any}, sitter: number, v: any)
    if sitter >= 0 and sitter < #t then
        t[sitter + 1] = v
    end
end

local function sitterKey(sitter: number): string
    local s = SITTERS[sitter + 1]
    return s or NULL
end

local function posOf(sitter: number): vector
    return POS_LIST[sitter + 1] or ZERO_VECTOR
end

local function rotOf(sitter: number): vector
    return ROT_LIST[sitter + 1] or ZERO_VECTOR
end

local function Readout_Say(say: string)
    local objectname = ll.GetObjectName()
    ll.SetObjectName("")
    ll.RegionSayTo(ll.GetOwner(), 0, "◆" .. say)
    ll.SetObjectName(objectname)
end

--------------------------------------------------------------------------
-- Menus and helpers
--------------------------------------------------------------------------
local function stop_all_anims(id: uuid)
    for _, anim in ll.GetAnimationList(id) do
        ll.MessageLinked(LINK_THIS, 90002, tostring(anim), tostring(id))
    end
end

local function preview_anim(anim: string, id: string)
    if isKey(id) then
        stop_all_anims(K(id))
        ll.MessageLinked(LINK_THIS, 90001, anim, id)
    end
end

local facial_anim_list = {
    "none",
    "express_afraid_emote",
    "express_anger_emote",
    "express_laugh_emote",
    "express_bored_emote",
    "express_cry_emote",
    "express_embarrassed_emote",
    "express_sad_emote",
    "express_toothsmile",
    "express_smile",
    "express_surprise_emote",
    "express_worry_emote",
    "express_repulsed_emote",
    "express_shrug_emote",
    "express_wink_emote",
    "express_disdain",
    "express_frown",
    "express_kiss",
    "express_open_mouth",
    "express_tongue_out",
}

local function get_choices(): {string}
    local my_number_per_page = number_per_page
    if adding == "[SYNC]" and sitter_count > 1 then
        my_number_per_page -= 1
    end
    local options = {}
    local total
    local start = my_number_per_page * menu_page -- 0-based
    local finish = start + my_number_per_page
    if adding == "[FACE]" then
        total = #facial_anim_list
        for i = start + 1, math.min(finish, total) do
            table.insert(options, facial_anim_list[i])
        end
    else
        local invtype = INVENTORY_ANIMATION
        if adding == "[PROP]" then
            invtype = INVENTORY_OBJECT
        end
        total = ll.GetInventoryNumber(invtype)
        local i = start
        while i < finish and i < total do
            local name = ll.GetInventoryName(invtype, i + 1)
            if not isHelperName(name) then
                table.insert(options, name)
            end
            i += 1
        end
    end
    menu_pages = math.ceil(total / my_number_per_page)
    return options
end

local function sitter_text(sitter: number): string
    return " for SITTER " .. tostring(sitter)
end

local function choice_menu(options: {string}, menu_text: string)
    last_text = menu_text
    menu_text = "\n(Page " .. tostring(menu_page + 1) .. "/" .. tostring(menu_pages) .. ")\n" .. menu_text .. "\n\n"
    local menu_items = {}
    if #options == 0 then
        menu_text = "\nNo items of required type in prim inventory."
        menu_items = { "[BACK]" }
    else
        local cutoff = 65
        local all_options_length = charLen(table.concat(options, ""))
        if 412 - all_options_length < 0 then
            cutoff = 43
        end
        -- FIX: the 412-character threshold above (upstream) did not count the rest of
        -- the dialog text, so long names could still make the message 512 bytes or
        -- more and llDialog showed nothing. When the lines do not fit, each name gets
        -- an equal share of the bytes left (animation names can be Unicode).
        local fixed = #menu_text
        local lines: {string} = {}
        local total = fixed
        for i, item in options do
            if charLen(item) > cutoff then
                item = ll.GetSubString(item, 1, cutoff + 1) .. ".."
            end
            lines[i] = tostring(i) .. "." .. item .. "\n"
            total += #lines[i]
        end
        if total > 511 then
            local share = math.floor((511 - fixed) / #options)
            for i, item in options do
                local room = share - #(tostring(i) .. ".") - #"..\n"
                if #(tostring(i) .. "." .. item .. "\n") > share then
                    local n = charLen(item)
                    while n > 0 and #ll.GetSubString(item, 1, n) > room do
                        n -= 1
                    end
                    local cut = if n > 0 then ll.GetSubString(item, 1, n) else ""
                    lines[i] = tostring(i) .. "." .. cut .. "..\n"
                else
                    lines[i] = tostring(i) .. "." .. item .. "\n"
                end
            end
        end
        for i, line in lines do
            table.insert(menu_items, tostring(i))
            menu_text ..= line
        end
        if adding == "[SYNC]" and sitter_count > 1 then
            table.insert(menu_items, "[DONE]")
        end
        table.insert(menu_items, "[BACK]")
        table.insert(menu_items, "[<<]")
        table.insert(menu_items, "[>>]")
    end
    ll.Dialog(K(controller), menu_text, orderButtons(menu_items), comm_channel)
end

local function ask_anim()
    choice_menu(get_choices(), "Choose anim" .. sitter_text(sitter_count) .. ":")
end

local function new_menu()
    menu_page = 0
    local menu_items = { "[BACK]", "[POSE]", "[SYNC]", "[SUBMENU]" }
    if (SITTER_POSES[active_sitter + 1] or "") ~= "" then
        table.insert(menu_items, "[PROP]")
        table.insert(menu_items, "[FACE]")
    end
    table.insert(menu_items, "[CAMERA]")
    ll.Dialog(K(controller), "\nWhat would you like to create?\n\n(Remember to delete " .. ll.GetScriptName() .. " and the helper before you sell or give this object.)", orderButtons(menu_items), comm_channel)
end

local function end_helper_mode()
    ll.RegionSay(comm_channel, "DONEA")
    helper_mode = false
end

local function Out(out: string)
    print(ll.GetScriptName() .. "[" .. VERSION .. "] " .. out)
end

local function get_number_of_scripts(): number
    local i = 1
    while ll.GetInventoryType(main_script .. " " .. tostring(i)) == INVENTORY_SCRIPT do
        i += 1
    end
    return i
end

local function convert_to_world_positions(sitter: number): string
    local target_rot = ll.Euler2Rot(rotOf(sitter) * DEG_TO_RAD) * ll.GetRot()
    local target_pos = posOf(sitter) * ll.GetRot() + ll.GetPos()
    return lslVec(target_pos) .. "|" .. lslRot(target_rot)
end

local function remove_script(reason: string)
    local message = "\n" .. ll.GetScriptName() .. " ==Script Removed==\n\n" .. reason
    ll.Dialog(ll.GetOwner(), message, { "OK" }, -3675)
    ll.InstantMessage(ll.GetOwner(), message)
    ll.RemoveInventory(ll.GetScriptName())
end

local function back_to_menu(sitter: number)
    ll.MessageLinked(LINK_THIS, 90005, "", controller .. "|" .. sitterKey(sitter))
end

local function done_choosing_anims()
    local adding_text = L(ll.ParseString2List(adding, { "[", "]" }, {}), 1)
    adding ..= "2"
    local text = ""
    for i, anim in chosen_animations do
        text ..= "\nSITTER " .. tostring(i - 1) .. ": " .. anim
    end
    ll.TextBox(K(controller), "\nType a menu name for " .. adding_text .. text, comm_channel)
end

local function camera_menu()
    local text = "\nCamera:\n\n"
    if ll.GetInventoryType(camera_script) == INVENTORY_SCRIPT then
        text ..= "(using " .. camera_script .. " scripts)"
    else
        text ..= "(prim property)"
    end
    ll.Dialog(K(controller), text, { "[BACK]", "[SAVE]", "[CLEAR]" }, comm_channel)
end

local function unsit_all()
    local i = ll.GetNumberOfPrims()
    while ll.GetAgentSize(ll.GetLinkKey(i)) ~= ZERO_VECTOR do
        stop_all_anims(ll.GetLinkKey(i))
        ll.UnSit(ll.GetLinkKey(i))
        i -= 1
    end
end

local function toggle_helper_mode()
    helper_mode = not helper_mode
    if helper_mode then
        if OLD_HELPER_METHOD ~= 0 then
            unsit_all()
        end
        -- (the comm_channel listen is opened once at startup, see init)
        local helper = helperName()
        for i = 0, #SITTERS - 1 do
            local param = comm_channel - i
            if #SITTERS == 1 then
                param = comm_channel - ll.GetLinkNumber()
            end
            local offset = posOf(i)
            if vector.magnitude(offset) > 10 then
                offset = ZERO_VECTOR
            end
            ll.RezAtRoot(helper, ll.GetPos() + offset * ll.GetRot(), ZERO_VECTOR, ll.Euler2Rot(rotOf(i) * DEG_TO_RAD) * ll.GetRot(), param)
        end
    else
        end_helper_mode()
    end
end

--------------------------------------------------------------------------
-- DUMP
--------------------------------------------------------------------------
-- [LS]faces-camera answers for every sitter (the copy responsible for that sitter replies)
local dump_scripts = { prop_script, expression_script, rlv_script, "[LS]commands" } -- LuaSitter: + [LS]commands (COMMANDS line)

-- 90021: a script finished dumping sitter <msg>; ask the next one
local function dump_next(msg: string, id: string)
    local script_channel = int(msg)
    -- LSL used llListFindList (-1 when not found, e.g. id "" from the sit
    -- script) and pre-incremented, so the search starts after the script that
    -- just reported, or at the first plugin.
    local start = (table.find(dump_scripts, id) or 0) + 1
    for i = start, #dump_scripts do
        if ll.GetInventoryType(dump_scripts[i]) == INVENTORY_SCRIPT then
            ll.MessageLinked(LINK_THIS, 90020, tostring(script_channel), dump_scripts[i])
            return
        end
    end
    if ll.GetInventoryType(main_script .. " " .. tostring(script_channel + 1)) == INVENTORY_SCRIPT then
        ll.MessageLinked(LINK_THIS, 90020, tostring(script_channel + 1), "")
    else
        Readout_Say("")
        Readout_Say("--✄--COPY ABOVE INTO \"" .. posCard() .. "\" NOTECARD--✄--")
        Readout_Say("")
    end
end

-- "V:" line: header (sitter 0) and SITTER line
local function dump_header(data: {string}, id: string)
    if int(id) == 0 then
        Readout_Say("")
        Readout_Say("--✄--COPY BELOW INTO \"" .. posCard() .. "\" NOTECARD--✄--")
        Readout_Say("")
        Readout_Say("\"" .. ll.ToUpper(ll.GetObjectName()) .. "\" " .. replace(L(data, 1), "V:", "LuaSitter "))
        if int(L(data, 2)) ~= 0 then
            Readout_Say("MTYPE " .. L(data, 2))
        end
        if int(L(data, 3)) ~= 1 then
            Readout_Say("ETYPE " .. L(data, 3))
        end
        if int(L(data, 4)) > -1 then
            Readout_Say("SET " .. L(data, 4))
        end
        if int(L(data, 5)) ~= 2 then
            Readout_Say("SWAP " .. L(data, 5))
        end
        if L(data, 7) ~= "" then
            Readout_Say("TEXT " .. replace(L(data, 7), "\n", "\\n"))
        end
        if L(data, 8) ~= "" then
            Readout_Say("ADJUST " .. replace(L(data, 8), SEP, "|"))
        end
        if int(L(data, 9)) ~= 0 then
            Readout_Say("SELECT " .. L(data, 9))
        end
        if int(L(data, 10)) ~= 2 then
            Readout_Say("AMENU " .. L(data, 10))
        end
        if int(L(data, 11)) ~= 0 then
            Readout_Say("HELPER " .. L(data, 11))
        end
        -- LuaSitter fields (0-based 11..17); missing fields mean defaults
        if int(L(data, 12)) ~= 0 then
            Readout_Say("KFM " .. L(data, 12))
        end
        if int(L(data, 13)) ~= 0 then
            Readout_Say("LROT " .. L(data, 13))
        end
        if L(data, 14) ~= "" and int(L(data, 14)) ~= 1 then
            Readout_Say("DFLT " .. L(data, 14))
        end
        if L(data, 15) ~= "" and int(L(data, 15)) ~= 1 then
            Readout_Say("WARN " .. L(data, 15))
        end
        if L(data, 16) ~= "" then
            Readout_Say("BRAND " .. replace(L(data, 16), SEP, "|"))
        end
        local roles = L(data, 17)
        if roles ~= "" then
            local letters = {}
            for i = 1, charLen(roles) do
                table.insert(letters, ll.GetSubString(roles, i, i))
            end
            Readout_Say("ROLES " .. table.concat(letters, "|"))
        end
        if L(data, 18) ~= "" then
            Readout_Say("ONSIT " .. replace(L(data, 18), SEP, "|"))
        end
    end
    Readout_Say("")
    if #SITTERS > 1 or L(data, 6) ~= "" then
        local SITTER_TEXT = ""
        if L(data, 6) ~= "" then
            SITTER_TEXT = "|" .. replace(L(data, 6), SEP, "|")
        end
        Readout_Say("SITTER " .. id .. SITTER_TEXT)
        Readout_Say("")
    end
end

-- 90022: one dump line
local function dump_line(msg: string, id: string)
    local head = string.sub(msg, 1, 4)
    local fromSit = string.sub(msg, 1, 2) == "S:"
    if head == "S:M:" or head == "S:T:" then
        msg = replace(msg, "*|", "|")
    end
    if string.sub(msg, 1, 2) == "V:" then
        dump_header(split(msg, "|"), id)
        return
    elseif string.sub(msg, 1, 1) == "{" then
        msg = replace(msg, "{P:", "{")
        local close = ll.SubStringIndex(msg, "}") or 0
        local after = table.concat(ll.ParseString2List(ll.GetSubString(msg, close + 1, -1), { " " }, {}), "")
        local parts = split(after, "<")
        local pos2 = vec("<" .. L(parts, 2))
        local rot2 = vec("<" .. L(parts, 3))
        local result = "<" .. FormatFloat(pos2.x, 3) .. "," .. FormatFloat(pos2.y, 3) .. "," .. FormatFloat(pos2.z, 3) .. ">"
        result ..= "<" .. FormatFloat(rot2.x, 1) .. "," .. FormatFloat(rot2.y, 1) .. "," .. FormatFloat(rot2.z, 1) .. ">"
        msg = (if close > 0 then ll.GetSubString(msg, 1, close) else ll.GetSubString(msg, 1, -1)) .. result
    elseif ll.GetSubString(msg, 2, 2) == ":" then
        msg = replace(msg, "S:P:", "POSE ")
        msg = replace(msg, "S:M:", "MENU ")
        msg = replace(msg, "S:T:", "TOMENU ")
        if ll.GetSubString(msg, -6, -1) == "|90210" then
            msg = replace(msg, "S:B:", "SEQUENCE ")
            msg = replace(msg, "|90210", "")
        else
            msg = replace(msg, "S:B:", "BUTTON ")
            if ll.SubStringIndex(msg, SEP) == nil then
                msg = replace(msg, "|90200", "")
            end
        end
        msg = replace(msg, "S:", "SYNC ")
        msg = replace(msg, SEP, "|")
    end
    -- FIX: only menu entries from [LS]sit carry the "*" marker; plugin lines (e.g. RLV
    -- restrictions ending in "*") must be dumped unchanged
    if fromSit and ll.GetSubString(msg, -1, -1) == "*" then
        msg = ll.GetSubString(msg, 1, -2)
    end
    if ll.GetSubString(msg, -1, -1) == "|" then
        msg = ll.GetSubString(msg, 1, -2)
    end
    if string.sub(msg, 1, 4) == "MENU" then
        Readout_Say("")
    end
    Readout_Say(msg)
end

--------------------------------------------------------------------------
-- Events
--------------------------------------------------------------------------
LLEvents:on("link_message", function(sender: number, num: number, msg: string, id: string)
    if sender ~= ll.GetLinkNumber() then
        return
    end
    local one = int(msg)
    if num == 90065 then
        local i = table.find(SITTERS, id)
        if i then
            SITTERS[i] = NULL
        end
        return
    end
    if num == 90030 or num == 90032 then -- 90032: swap and return the menu (issue #140)
        local two = int(id)
        setAt(SITTERS, one, NULL)
        setAt(SITTERS, two, NULL)
        if OLD_HELPER_METHOD ~= 0 and helper_mode then
            -- FIX: upstream swapped llList2Integer() of keys (always 0); swap the keys
            local a, b = HELPER_KEY_LIST[one + 1], HELPER_KEY_LIST[two + 1]
            setAt(HELPER_KEY_LIST, one, b or NULL)
            setAt(HELPER_KEY_LIST, two, a or NULL)
            ll.RegionSay(comm_channel, "SWAP|" .. msg .. "|" .. id)
        end
        return
    end
    if num == 90070 then
        setAt(SITTERS, one, id)
        return
    end
    if num == 90021 then
        dump_next(msg, id)
        return
    end
    if num == 90022 then
        dump_line(msg, id)
        return
    end
    if num == 90100 or num == 90101 then
        local data = split(msg, "|")
        local cmd = L(data, 2)
        if cmd == "[DUMP]" then
            if id ~= owner() then
                ll.RegionSayTo(K(id), 0, "Dumping settings to Owner")
            end
            ll.MessageLinked(LINK_THIS, 90020, "0", "")
        elseif cmd == "[NEW]" then
            controller = L(data, 3)
            active_sitter = int(L(data, 1))
            adding = ""
            new_menu()
        elseif cmd == "[SAVE]" then
            for i = 0, #SITTERS - 1 do
                local pose = SITTER_POSES[i + 1] or ""
                if pose ~= "" then
                    local ptype = "SYNC"
                    local temp_pose_name = pose
                    if startsWith(pose, "P:") then
                        ptype = "POSE"
                        temp_pose_name = ll.GetSubString(temp_pose_name, 3, -1)
                    end
                    local p, r = lslVec(posOf(i)), lslVec(rotOf(i))
                    ll.MessageLinked(LINK_THIS, 90301, tostring(i), pose .. "|" .. p .. "|" .. r .. "|")
                    ll.Say(0, ptype .. " Saved to memory " .. sitter_text(i) .. ": {" .. temp_pose_name .. "}" .. p .. r)
                end
            end
            ll.MessageLinked(LINK_THIS, 90005, "", L(data, 3) .. "|" .. id)
        elseif cmd == "[HELPER]" then
            controller = id
            OLD_HELPER_METHOD = int(L(data, 4))
            toggle_helper_mode()
        elseif cmd == "[ADJUST]" then
            end_helper_mode()
        end
        return
    end
    if num == 90055 or num == 90056 then
        local data = split(id, "|")
        setAt(SITTER_POSES, one, L(data, 1))
        setAt(POS_LIST, one, vec(L(data, 3)))
        setAt(ROT_LIST, one, vec(L(data, 4)))
        if helper_mode then
            ll.RegionSay(comm_channel, "POS|" .. tostring(one) .. "|" .. convert_to_world_positions(one) .. "|" .. tostring(OLD_HELPER_METHOD) .. "|" .. sitterKey(one))
        end
    end
end)

LLEvents:on("changed", function(change: number)
    if bit32.band(change, CHANGED_LINK) ~= 0 then
        local last_is_avatar = ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) ~= ZERO_VECTOR
        if OLD_HELPER_METHOD ~= 0 then
            if last_is_avatar then
                end_helper_mode()
            end
        elseif (#SITTERS == 1 and ll.AvatarOnSitTarget() == NULL_KEY) or not last_is_avatar then
            end_helper_mode()
        end
    end
    if bit32.band(change, CHANGED_INVENTORY) ~= 0 then
        unsit_all()
        end_helper_mode()
        ll.ResetScript()
    end
end)

LLEvents:on("run_time_permissions", function(_perm: number)
    if bit32.band(ll.GetPermissions(), PERMISSION_TRACK_CAMERA) ~= 0 then
        ll.PlaySound("3d09f582-3851-c0e0-f5ba-277ac5c73fb4", 1.0)
        local eye = (ll.GetCameraPos() - ll.GetPos()) / ll.GetRot()
        local at = eye + quaternion.tofwd(ll.GetCameraRot() / ll.GetRot())
        if ll.GetInventoryType(camera_script) == INVENTORY_SCRIPT then
            ll.MessageLinked(LINK_THIS, 90174, tostring(active_sitter), lslVec(eye) .. "|" .. lslVec(at))
        else
            ll.MessageLinked(LINK_THIS, 90011, lslVec(eye), lslVec(at))
            ll.Say(0, "Camera property saved for all sitters in prim (takes effect next sit).")
        end
        camera_menu()
    end
end)

local function controller_listen(id: string, msg: string)
    if msg == "[>>]" then
        menu_page += 1
        if menu_page >= menu_pages then
            menu_page = 0
        end
        choice_menu(get_choices(), last_text)
    elseif msg == "[<<]" then
        menu_page -= 1
        if menu_page < 0 then
            menu_page = menu_pages - 1
        end
        choice_menu(get_choices(), last_text)
    elseif msg == "[BACK]" then
        back_to_menu(active_sitter)
    elseif msg == "[POSE]" or msg == "[SYNC]" then
        adding = msg
        chosen_animations = {}
        sitter_count = active_sitter
        end_count = sitter_count
        if msg == "[SYNC]" then
            sitter_count = 0
            end_count = #SITTERS - 1
        end
        ask_anim()
    elseif msg == "[SUBMENU]" then
        adding = msg
        ll.TextBox(K(controller), "\n\nName your submenu:", comm_channel)
    elseif msg == "[PROP]" then
        if ll.GetInventoryType(prop_script) == INVENTORY_SCRIPT then
            adding = msg
            choice_menu(get_choices(), "Choose your prop:")
        else
            ll.Say(0, "For this you need the " .. prop_script .. " plugin script.")
            back_to_menu(active_sitter)
        end
    elseif msg == "[FACE]" then
        if ll.GetInventoryType(expression_script) == INVENTORY_SCRIPT then
            adding = msg
            choice_menu(get_choices(), "Choose your facial anim:")
        else
            ll.Say(0, "For this you need the " .. expression_script .. " plugin script.")
            back_to_menu(active_sitter)
        end
    elseif msg == "[CAMERA]" then
        camera_menu()
    elseif msg == "[CLEAR]" then
        -- FIX: upstream looped 0..prims-1, so the last prim of a linkset was not cleared
        for i = 0, ll.GetNumberOfPrims() do
            ll.SetLinkCamera(i, ZERO_VECTOR, ZERO_VECTOR)
        end
        if ll.GetInventoryType(camera_script) == INVENTORY_SCRIPT then
            ll.MessageLinked(LINK_THIS, 90174, tostring(active_sitter), "none")
        else
            ll.Say(0, "Camera property cleared from all prims (takes effect next sit).")
        end
        camera_menu()
    elseif msg == "[SAVE]" then
        ll.RequestPermissions(K(id), PERMISSION_TRACK_CAMERA)
    elseif table.find({ "[DONE]", "1", "2", "3", "4", "5", "6", "7", "8", "9" }, msg)
        and table.find({ "[POSE]", "[SYNC]", "[SYNC]2", "[PROP]", "[FACE]" }, adding) then
        local choice = get_choices()[int(msg)] or ""
        if adding == "[PROP]" then
            local perms = ll.GetInventoryPermMask(choice, MASK_NEXT)
            if bit32.band(perms, PERM_COPY) == 0 then
                ll.Say(0, "Could not add prop '" .. choice .. "'. Props and their content must be COPY-OK for NEXT owner.")
            else
                ll.MessageLinked(LINK_THIS, 90171, tostring(active_sitter), choice)
            end
            back_to_menu(active_sitter)
        elseif adding == "[FACE]" then
            ll.MessageLinked(LINK_THIS, 90172, tostring(active_sitter), choice)
            back_to_menu(active_sitter)
        elseif msg == "[DONE]" then
            done_choosing_anims()
        elseif adding == "[SYNC]" or adding == "[POSE]" then
            table.insert(chosen_animations, choice)
            preview_anim(choice, sitterKey(sitter_count))
            sitter_count += 1
            if sitter_count > end_count then
                done_choosing_anims()
            else
                ask_anim()
            end
        end
    else
        msg = replace(msg, "\n", "")
        msg = replace(msg, "|", "")
        msg = ll.GetSubString(msg, 1, 23)
        if msg == "" then
            back_to_menu(active_sitter)
        elseif adding == "[SUBMENU]" then
            ll.MessageLinked(LINK_THIS, 90300, tostring(active_sitter), "T:" .. msg .. "*" .. "||")
            ll.MessageLinked(LINK_THIS, 90300, tostring(active_sitter), "M:" .. msg .. "*" .. "||")
            ll.Say(0, "MENU Added: '" .. msg .. "'" .. sitter_text(active_sitter))
            back_to_menu(active_sitter)
        elseif adding == "[POSE]2" or adding == "[SYNC]2" then
            local start = 0
            local finish = #chosen_animations
            local ptype = "SYNC"
            local prefix = ""
            if adding == "[POSE]2" then
                prefix = "P:"
                ptype = "POSE"
                start = active_sitter
                finish = active_sitter + 1
            end
            local x = 1
            for i = start, finish - 1 do
                local anim = chosen_animations[x] or ""
                ll.Say(0, ptype .. " Added: '" .. msg .. "' using anim '" .. anim .. "' to SITTER " .. tostring(i))
                ll.MessageLinked(LINK_THIS, 90300, tostring(i), prefix .. msg .. "|" .. anim .. "|" .. lslVec(posOf(i)) .. "|" .. lslVec(rotOf(i)))
                x += 1
            end
            back_to_menu(active_sitter)
        end
    end
end

local function helper_listen(name: string, id: uuid, msg: string)
    local data = ll.ParseString2List(msg, { "|" }, {})
    local cmd = L(data, 1)
    local n = int(L(data, 2))
    if cmd == "REG" then
        setAt(HELPER_KEY_LIST, n, tostring(id))
        ll.RegionSay(comm_channel, "POS|" .. tostring(n) .. "|" .. convert_to_world_positions(n) .. "|" .. tostring(OLD_HELPER_METHOD) .. "|" .. sitterKey(n))
    elseif cmd == "MENU" then
        if L(data, 3) == controller then
            ll.MessageLinked(LINK_SET, 90005, "", controller .. "|" .. sitterKey(n))
        end
    elseif cmd == "MOVED" then
        local f = ll.GetRot()
        local target_rot = ll.Rot2Euler(rot(L(data, 4)) / f) * RAD_TO_DEG
        local target_pos = (vec(L(data, 3)) - ll.GetPos()) / f
        if lslVec(target_pos) ~= lslVec(posOf(n)) or lslVec(target_rot) ~= lslVec(rotOf(n)) then
            setAt(POS_LIST, n, target_pos)
            setAt(ROT_LIST, n, target_rot)
            ll.MessageLinked(LINK_THIS, 90057, tostring(n), lslVec(target_pos) .. "|" .. lslVec(target_rot))
        end
    elseif OLD_HELPER_METHOD ~= 0 then
        local sp = ll.SubStringIndex(name, " ")
        local sitter = int(if sp then ll.GetSubString(name, sp + 1, -1) else name)
        local av = L(data, 2)
        if av == "" then
            av = NULL
        end
        if cmd == "ANIMA" then
            ll.MessageLinked(LINK_THIS, 90075, tostring(sitter), av)
        elseif cmd == "GETUP" then
            ll.MessageLinked(LINK_THIS, 90076, tostring(sitter), av)
        end
    end
end

LLEvents:on("listen", function(chan: number, name: string, id: uuid, msg: string)
    local sid = tostring(id)
    if chan == chat_channel then
        if msg == "cleanup" then
            ll.RegionSay(comm_channel, "DONEA")
            Out("Cleaning \"" .. ll.GetScriptName() .. "\" and \"" .. helperName() .. "\" from prim " .. tostring(ll.GetLinkNumber()))
            for _, h in helper_names do
                if ll.GetInventoryType(h) == INVENTORY_OBJECT then
                    ll.RemoveInventory(h)
                end
            end
            ll.RemoveInventory(ll.GetScriptName())
        elseif msg == "targets" then
            ll.MessageLinked(LINK_THIS, 90298, "", "")
        elseif msg == "helper" then
            if ll.GetAgentSize(ll.GetLinkKey(ll.GetNumberOfPrims())) ~= ZERO_VECTOR then
                ll.MessageLinked(LINK_SET, 90100, "0|[HELPER]||" .. tostring(OLD_HELPER_METHOD), sitterKey(0))
            end
        end
    elseif sid == controller then
        controller_listen(sid, msg)
    elseif ll.GetOwnerKey(id) == ll.GetOwner() then
        helper_listen(name, id, msg)
    end
end)

LLEvents:on("on_rez", function(_param: number)
    ll.ResetScript()
end)

--------------------------------------------------------------------------
-- Init (was state_entry)
--------------------------------------------------------------------------
-- [LS]adjuster is a setup tool. Creators often forget it in sold products, so remind
-- the owner every time the object is rezzed or the script starts. It may stay in
-- sold furniture: a customer can use it to adjust and add poses.
local function setup_tool_notice()
    local name = ll.GetScriptName()
    if ll.GetOwner() == ll.GetCreator() then
        print("NOTICE: \"" .. name .. "\" is a setup tool for creating poses. If your customers should not edit poses, delete it (and the helper object) before you sell or give the object. Type /" .. tostring(chat_channel) .. " cleanup to remove both.")
    else
        print("NOTICE: this furniture contains \"" .. name .. "\", the pose setup tool. You can use it to adjust, add and save poses. It is not needed to sit; type /" .. tostring(chat_channel) .. " cleanup if you want to remove it.")
    end
end

local function init()
    if ll.SubStringIndex(ll.GetScriptName(), " ") ~= nil then
        remove_script("Use only one of this script!")
        return
    end
    setup_tool_notice()
    ll.Listen(chat_channel, "", ll.GetOwner(), "")
    comm_channel = -(int(ll.Frand(99999)) + 1) * 1000
    for _ = 1, get_number_of_scripts() do
        table.insert(SITTERS, NULL)
        table.insert(POS_LIST, ZERO_VECTOR)
        table.insert(ROT_LIST, ZERO_VECTOR)
        table.insert(HELPER_KEY_LIST, NULL)
        table.insert(SITTER_POSES, "")
    end
    if #SITTERS == 1 then
        comm_channel -= 1000000000
    end
    -- FIX: upstream only opened the comm_channel listen when helper mode was
    -- first switched on (and opened another one on every toggle), so the
    -- [NEW] menu dialogs could not be answered before using [HELPER].
    ll.Listen(comm_channel, "", NULL_KEY, "")
end

init()

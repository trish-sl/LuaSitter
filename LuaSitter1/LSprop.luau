--[[
  LSprop - script inside AVsitter1-style props
  LuaSitter: SLua port of AVsitter(TM) AVprop (AVsitter1). Derived from the AVsitter source code.
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
  Copyright (c) the AVsitter Contributors (http://avsitter.github.io)
  Copyright (c) the LuaSitter Contributors
]]

--[[
  What it does
  ------------
  Put inside every prop object used by LSplus (replaces AVsitter1 "AVprop").
  When rezzed by LSplus (start parameter = LSplus comm channel) it dies on
  "REMPROPS" and answers "PROPSEARCH" with "SAVEPROP" so LSplus can record
  its position. Lives in a separate object, so it cannot be merged.
]]

local startparam = 0

LLEvents:on("on_rez", function(start: number)
    if start ~= 0 then
        startparam = start
        ll.Listen(startparam, "", NULL_KEY, "REMPROPS")
        ll.Listen(startparam, "", NULL_KEY, "PROPSEARCH")
    end
end)

LLEvents:on("listen", function(_channel: number, _name: string, _id: uuid, message: string)
    if message == "REMPROPS" then
        ll.Die()
    elseif message == "PROPSEARCH" then
        ll.Shout(startparam, "SAVEPROP")
    end
end)

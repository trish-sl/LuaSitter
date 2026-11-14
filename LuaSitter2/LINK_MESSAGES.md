# LuaSitter2 Developer Link Message Reference

The following [link messages](http://wiki.secondlife.com/wiki/Link_message) are used in LuaSitter2. They are the same messages, with the same payloads, as AVsitter2, so LSL plugins written for AVsitter2 keep working with LuaSitter2.

Differences from AVsitter2:

- Script names use the `[LS]` prefix (`[AV]sitA` and `[AV]sitB` are now one script, `[LS]sit`; `[AV]root-RLV-extra` is part of `[LS]root-RLV`).
- In SLua the 4th link message parameter is a string, not a key. LSL scripts still receive it as a key.
- Messages that only travelled between `[AV]sitA` and `[AV]sitB` are no longer sent: **90299**, **90302**, and the 90300/90301 that sitA sent to sitB while reading the notecard. `[LS]sit` still accepts **90300**/**90301** from `[LS]adjuster`, and still broadcasts **90055**.
- Messages that only travelled between `[AV]root-RLV` and `[AV]root-RLV-extra` became function calls inside `[LS]root-RLV` (see that script's header for details). **90208**/**90209** are no longer sent, but `[LS]root-RLV` still answers them.
- New: **90032** (swap and return the menu), for the `[LS]commands` plugin **90013**, **90016**, **90017**, **90018**; for the `[LS]chains` plugin **90240**, **90241**, **90242**; and for the `[LS]options` plugin **90250**. `[LS]root-RLV` also answers the DUMP chain (90020/90021/90022).
- `[AV]prop`, `[AV]sequence` and `[AV]favs` are one script, `[LS]plugins`; `[AV]faces` and `[AV]camera` are `[LS]faces-camera`. In the DUMP chain (90020) the script ids are `[LS]plugins`, `[LS]faces-camera` (one request per sitter, answered by the copy responsible for that sitter) and `[LS]root-RLV`.

This list is not intended for the casual user. Public API info for general users can be found [here](https://avsitter.github.io/avsitter2.html) (it applies to LuaSitter2 too, with `[LS]` script names).

This page may provide additional info if the purpose of a link message is not initially clear.

**LuaSitter2 uses link messages in the range 90000-90500.**

### 90000
Play a pose defined in the pose notecard (`LSpos` or `AVpos`).

    llMessageLinked(LINK_THIS,90000,<POSE_NAME>,<CUSTOM>);
    
    Where for <CUSTOM>:
        ""      = try to play the pose for all SITTERS.
        UUID    = try to play the pose to avatar by UUID.
        integer = apply the pose to a sitter e.g. SITTER 0.

### 90001
Play an overlay animation ([LS]adjuster, [LS]faces-camera).

    llMessageLinked(LINK_THIS,90001,<ANIMATION_FILE>,<AVATAR_UUID>);

### 90002
Stop an additional animation ([LS]adjuster, [LS]faces-camera).

    llMessageLinked(LINK_THIS,90002,<ANIMATION_FILE>,<AVATAR_UUID>);

### 90003
Same as 90000 but ignored by the sequence module of [LS]plugins, so that a running sequence is not stopped when the sequence module itself plays poses.

### 90004
Same as 90005 but returns to top level of the menu (used by [LS]root-RLV when pressing [MENU]).

### 90005
Give the menu. Optionally set controller avatar and/or submenu.

Note: [LS]menu only accepts the first form below; it does not accept TOMENU or CONTROLLER_UUID.

    llMessageLinked(LINK_SET,90005,"",<AVATAR_UUID>);
    llMessageLinked(LINK_SET,90005,<TOMENU>,[<CONTROLLER_UUID>|<AVATAR_UUID>]);
    
    TOMENU=-1 ensures when sitters first sit they will get [LS]select menu if the [LS]select script is present

### 90006
Register touch or sit to [LS]root-security script from [LS]sit after permissions granted.

    llMessageLinked(LINK_SET,90006,"",<AVATAR_UUID>);
    llMessageLinked(LINK_SET,90006,<FUNCTION>,<AVATAR_UUID>); // for [LS]select
    
    FUNCTION=-1 ensures when sitters first sit they will get [LS]select menu if the [LS]select script is present

### 90007
[LS]root-security passes touch to [LS]root-control.

    llMessageLinked(LINK_SET,90007,"",<CONTROLLER_UUID>);

### 90008
Same as 90000 but if the pose is a SYNC pose, it's played by all sitters that have it, regardless of target (i.e. works pretty much like choosing the pose in the menu)

### 90009
Bring up [LS]select menu, sent by [LS]sit.

    llMessageLinked(LINK_SET,90009,"",<AVATAR_UUID>);

### 90010
Same as 90000 but ignores ETYPE.

### 90011
[LS]adjuster tells [LS]sit scripts to set the llSetLinkCamera().

### 90012
[LS]root-security passes touch or sit to [LS]root-RLV.

    llMessageLinked(LINK_THIS, 90012,<ACTIVE_PRIM>,<CONTROLLER_UUID>);

### 90013
New in LuaSitter. `[LS]commands` asks `[LS]root-security` to check a sitter's chat command. `"menu"` is handled like a touch by that avatar; any other command is answered with [90016](#90016) when the avatar has menu access.

    llMessageLinked(LINK_SET,90013,<COMMAND>,<AVATAR_UUID>);

### 90014
[LS]root-RLV notifies user scripts of the controlling avatar & captive avatars.

    llMessageLinked(LINK_SET,90014,llDumpList2String([CONTROLLER_UUID,llDumpList2String(CAPTIVES,",")],"|"),"");    

### 90015
Tells [LS]root-RLV to trigger a [STOP]. If the captive's keys are currently held, this requires the controlling avatar's UUID, which can be obtained via message [90014](#90014). If that UUID is `NULL_KEY`, the [STOP] will only trigger if the keys are NOT held. Optionally, the "\<captive name\> was released" message can be suppressed by passing `"1"` as `RELEASE_MSG_FLAG`. When passing `""` it will be shown normally.

    llMessageLinked(LINK_SET,90015,<RELEASE_MSG_FLAG>,<CONTROLLER_UUID>);

### 90016
New in LuaSitter. `[LS]root-security` allows a chat command checked with [90013](#90013). Sent to the link of the script that asked.

    llMessageLinked(<SENDER_LINK>,90016,<COMMAND>,<AVATAR_UUID>);

### 90017
New in LuaSitter. Tells the `[LS]sit` script of a sitter to play the next (`"1"`) or previous (`"-1"`) pose of the menu their current pose is in, as if chosen from the menu (POSE and SYNC entries, wrapping around).

    llMessageLinked(LINK_SET,90017,"1",<SITTER_UUID>);

### 90018
New in LuaSitter. Tells the `[LS]sit` script of a sitter to move (or turn) their pose by the smallest step, 0.01 m (or 1°), with the Position/Rotation mode of the personal adjust menu. `<KEYS>` lists the keys pressed, `|`-separated: `fwd`, `back`, `left`, `right`, `up`, `down` (Position: X+, X-, Y+, Y-, Z+, Z-; Rotation: Y+, Y-, Z+, Z-, X+, X-), and `turnleft`, `turnright` (Shift + Left / Right: turn around Z in both modes). `[SAVE]` in the adjust menu keeps the result.

    llMessageLinked(LINK_SET,90018,"fwd|up",<SITTER_UUID>);

### 90020
Tells a script to [DUMP] settings.

    llMessageLinked(LINK_THIS,90020,<SITTER>,<SCRIPT_NAME>);

### 90021
Tells [LS]adjuster to ask the next script to [DUMP] settings.

    llMessageLinked(LINK_THIS,90021,<SITTER#>,<SCRIPT_NAME>);

### 90022
Sends one [DUMP] settings line to [LS]adjuster.

    llMessageLinked(LINK_THIS,90022,<TEXT>,<SITTER#>);

The first line from [LS]sit starts with `V:` and holds `|`-separated settings: version, MTYPE, ETYPE, SET, SWAP, SITTER info, TEXT, ADJUST, SELECT, AMENU, HELPER, then (new in LuaSitter, ignored by older adjusters) KFM, LROT, DFLT, WARN, BRAND, ROLES, ONSIT.

### 90030
Tell [LS]sit scripts and [LS]adjuster to [SWAP] between two sitters.

    llMessageLinked(LINK_THIS,90030,<SITTER#>,<SITTER#>);

### 90032
New in LuaSitter. Same as 90030 (swap two sitters), and afterwards the menu is given back to the swapped sitters even when MTYPE would not show it on sit (AVsitter issue #140).

    llMessageLinked(LINK_THIS,90032,<SITTER#>,<SITTER#>);

### 90033
[LS]root-control tells listeners in [LS]sit & [LS]root-security scripts to reset after capture to prevent captive using an open menu, and when someone "takes control of menu".

    llMessageLinked(LINK_SET,90033,"","");

### 90045
[LS]sit gives info about the pose just played. Received by many scripts.

    link_message(integer sender, integer num, string msg, key id){
        if(num==90045){
           
            // The avatar UUID
            key AVATAR_UUID = id;
           
            // Extract the data into a list
            list data = llParseStringKeepNulls(msg,["|"],[]);
           
            // The SITTER# the pose is playing for
            integer SITTER_NUMBER = (integer)llList2String(data,0);
           
            // The name of the pose
            string POSE_NAME = llList2String(data,1);
           
            // The animation file
            string ANIM_FILE = llList2String(data,2);
           
            // The SET#
            integer SET = (integer)llList2String(data,3);
           
            // A list of UUIDs of all sitting avatars separated by the ( @ ) character
            list ALL_SITTERS = llParseStringKeepNulls(llList2String(data,4),["@"],[]);
           
            // The name the SYNC pose the avatar is leaving
            string OLD_SYNC_NAME = llList2String(data,5);
           
            // TRUE if the pose is a SYNC pose
            integer IS_SYNC = (integer)llList2String(data,6);
           
        }
    }


### 90050
A pose is selected from the menu

    default{
        link_message(integer sender, integer num, string msg, key id){
            if(num==90050){
                key AVATAR_UUID = id;
                list data = llParseStringKeepNulls(msg,["|"],[]);
                string SITTER_NUMBER = llList2String(data,0);
                string POSE_NAME = llList2String(data,1);
                string SET = llList2String(data,2);
            }
        }
    }

### 90051
Same as 90050 but when a TOMENU is selected from the menu.

### 90055
[LS]sit sends anim info to other scripts (used by [LS]adjuster).

    llMessageLinked(LINK_THIS,90055,<SITTER#>,<POSE_NAME,ANIMATION_FILE,POSITION,ROTATION,BROADCAST>);
    
    Where <BROADCAST> is if we want to send a 90045 in response.

### 90056
Same as 90055 but sent from [LS]sit when an avatar sits (so helper sticks know where to go). 

### 90057
Sent by [LS]adjuster when helper moves, so [LS]sit can update position.

    llMessageLinked(LINK_THIS,90057,<SITTER#>,<POSITION,ROTATION>);

### 90060
Welcome new sitter!

    llMessageLinked(LINK_SET,90060,"",<AVATAR_UUID>);

### 90065
Goodbye Sitter! Received by several scripts.

    llMessageLinked(LINK_SET,90065,<SITTER#>,<AVATAR_UUID>);

### 90070
Update list of SITTERS in various scripts after permissions granted. Received by several scripts.

    llMessageLinked(LINK_THIS,90070,<SITTER#>,<AVATAR_UUID>);

### 90075
Used by oldschool HELPER 1 method - ask to animate.

### 90076
Used by oldschool HELPER 1 method - stop animate.

### 90100
Menu choice from [LS]sit, also for the "RLV ▸" button (sent as "Control..."). Upstream [AV]root-RLV-extra also sent it for [BACK]; in [LS]root-RLV that is a direct call.

### 90101
Menu choice. Sent and received by several scripts.

    llMessageLinked(LINK_SET,90101,<SITTER#,MSG,CONTROLLER_UUID>,<AVATAR_UUID>);

### 90150
[LS]sit for SITTER 0 requests all [LS]sit scripts re-place their sittarget.

### 90171
[LS]adjuster add PROP line to [LS]plugins (props).

### 90172
[LS]adjuster add ANIM line to [LS]faces-camera.

### 90173
[LS]menu add PROP line to [LS]plugins (props).

### 90174
[LS]adjuster add CAMERA line to [LS]faces-camera.

### 90200
Default integer for a BUTTON line in the pose notecard. Used to rez props. If UUID is specified, menu is returned to that avatar. A second UUID can be specified to rez the prop for one avatar, but return the menu to another.

### 90220
Same as 90200 but no menu is returned. 

### 90201
[LS]sit asks for info about what plugins are available.

### 90202
Reply that script exists in root: [LS]root-security (and [LS]root-RLV).

### 90203
Reply that a texture plugin exists (originally [AV]texture, not part of LuaSitter). [LS]sit then shows a [TEXTURE] button in the pose menu. No LuaSitter script sends it; third-party plugins can.

### 90204
Reply that a color plugin exists (originally [AV]color, not part of LuaSitter). No LuaSitter script sends or reads it; reserved for third-party plugins.

### 90205
Toggle sound in [LS]plugins (sequences).

### 90206
[LS]root-RLV sends information to [LS]root-control.

### 90207
RLV sends hovertext details.

### 90208
Open the "Un/Dress" menu of [LS]root-RLV (upstream: [AV]root-RLV to [AV]root-RLV-extra). No longer sent by LuaSitter, still answered.

### 90209
Open the "Restrict" menu of [LS]root-RLV (upstream: [AV]root-RLV to [AV]root-RLV-extra). No longer sent by LuaSitter, still answered.

### 90210
Default integer for a SEQUENCE line in the pose notecard. Used by [LS]plugins (sequences).

### 90211
[LS]root-control sends [CAPTURE] message to [LS]root-RLV.

    llMessageLinked(LINK_THIS,90211,"",<CONTROLLER_UUID>);

### 90230
Control [LS]faces-camera cameras with BUTTON or link message.

    llMessageLinked(LINK_THIS,90230,<CAMERA_NAME>,<AVATAR_UUID>);

### 90231
Same as 90230 but no menu is returned.

### 90240
New in LuaSitter. Tells `[LS]chains` to switch chains on, and chain the current pose at once. Accepted from any prim. `<ID>` is a sitter's key, or `<CONTROLLER_UUID>|<SITTER_UUID>` (as BUTTON sends it); any other value (e.g. `""`) applies to every sitter. Chains are on for everyone by default, and again after a sitter stands up.

    llMessageLinked(LINK_SET,90240,"",<ID>);

### 90241
New in LuaSitter. Tells `[LS]chains` to switch chains off (removed at once; the pose is still followed). `<ID>` as for [90240](#90240).

    llMessageLinked(LINK_SET,90241,"",<ID>);

### 90242
New in LuaSitter. Tells `[LS]chains` to toggle chains on/off. `<ID>` as for [90240](#90240); for every sitter, it switches all off if any is on, else all on. Example menu button: `BUTTON Chains|90242`.

    llMessageLinked(LINK_SET,90242,"",<ID>);

### 90250
New in LuaSitter. Applies an option of `[LS]options` (textures, colours, lights, glow, alpha, sounds; see [Options](../docs/luasitter/options.md)). The message is the name of an OPTION, or of a TOGGLE (then its next option is applied). The key is ignored. From the pose menu: `BUTTON Lamp|90250` (the button name is the message) or `BUTTON Night light|90250|Night`.

    llMessageLinked(LINK_SET,90250,<OPTION_OR_TOGGLE_NAME>,"");

### 90298
[LS]adjuster tells [LS]sit to show SitTargets (/5 targets).

### 90299
Not used in LuaSitter (was: [AV]sitA resets [AV]sitB).

### 90300
[LS]adjuster adds a menu entry to [LS]sit.

    llMessageLinked(LINK_THIS,90300,<SITTER#>,<NAME>|<DATA>[|<POSITION>|<ROTATION>]);

### 90301
[LS]adjuster updates the position of a pose in [LS]sit.

    llMessageLinked(LINK_THIS,90301,<SITTER#>,<NAME>|<POSITION>|<ROTATION>|);

### 90302
Not used in LuaSitter (was: [AV]sitA sends notecard settings to [AV]sitB).

### 90401
[LS]plugins (favourites) command to add pose to favourites

    llMessageLinked(LINK_THIS,90401,<POSE_NAME>,<AVATAR_UUID>);

### 90402
[LS]plugins (favourites) command to remove pose from favourites

    llMessageLinked(LINK_THIS,90402,<POSE_NAME>,<AVATAR_UUID>);

### 90403
[LS]plugins (favourites) command to show favourites list

    llMessageLinked(LINK_THIS,90403,"",<AVATAR_UUID>);

### 90500
[LS]plugins reports on prop events (ATTACHED,DETACHED,REZ,DEREZ).

    default{
        link_message(integer sender, integer num, string msg, key id){
            if(num==90500){
                list data = llParseStringKeepNulls(msg,["|"],[]);
                key AVATAR_UUID = id;
                string EVENT = llList2String(data,0);
                string SITTER_NUMBER = llList2String(data,1);
                string PROP_NAME = llList2String(data,2);
                string PROP_OBJECT = llList2String(data,3);
                string PROP_GROUP = llList2String(data,4);
                string PROP_UUID = llList2String(data,5);
                llOwnerSay(llDumpList2String([EVENT, SITTER_NUMBER, PROP_NAME, PROP_OBJECT, PROP_GROUP, PROP_UUID, AVATAR_UUID],","));
            }
        }
    }




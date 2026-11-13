# AVsitter2 LSL Examples (AVprop)

> **LuaSitter note:** These examples are from the [AVsitter documentation](https://avsitter.github.io). They are LSL scripts and still work next to LuaSitter, because the link messages are unchanged (where a comment mentions an `[AV]` script, read the `[LS]` script). For SLua (Lua) versions of plugin scripts, see [Writing plugins in Lua](../luasitter/lua-plugins.md).


> **Note:** The following LSL script examples are dedicated to the Public Domain under the [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
> **Important:** Please read usage instructions given in the header of each script.
> **Tip:** Visit the [LSL Portal](http://wiki.secondlife.com/wiki/Category:LSL_Functions) for function reference.

## Animated Attachment

```js
/******************************************************************
* This optional script can be added to attachment props.
* Triggers an animation placed inside the attachment prop at regular intervals when attachment is worn (e.g. for sipping/drinking).
* Use with caution! The animation can easily interfere with other animations already playing.
* Animation should be uploaded with animation priority >= other animations that are playing.
******************************************************************/

float TIMER = 10.0; // how often to play the animation

/******************************************************************
* DON'T EDIT BELOW THIS UNLESS YOU KNOW WHAT YOU'RE DOING!
******************************************************************/

check_attached(){
    if(llGetAttached()){
        llRequestPermissions(llGetOwner(),PERMISSION_TRIGGER_ANIMATION);
    }
    else{
        integer perms = llGetPermissions();
        if(perms & PERMISSION_TRIGGER_ANIMATION){
            llStopAnimation(llGetInventoryName(INVENTORY_ANIMATION,0));
        }
        llSetTimerEvent(0);
    }
}

default{
    attach(key id){
        check_attached();
    }

    timer(){
        if(llGetAttached()){
            integer perms = llGetPermissions();
            if(perms & PERMISSION_TRIGGER_ANIMATION){
                llStartAnimation(llGetInventoryName(INVENTORY_ANIMATION,0));
            }
        }
    }

    run_time_permissions(integer perm){
        if(perm & PERMISSION_TRIGGER_ANIMATION){
            llSetTimerEvent(TIMER);
        }
    }

    on_rez(integer x){
        check_attached();
    }
}
```

## Prop Kill Script

```js
/******************************************************************
* Optional script can help protect prop objects, preventing them from being rezzed normally.
* Deletes/detaches a prop when it is rezzed normally, unless owned by creator of this script.
* The prop will still function normally when rezzed by furniture.

* Normal props (and contents) must be COPY-OK and NO-MOD for NEXT OWNER.
* Attachment props (and contents) must be COPY-TRANSFER and NO-MOD for NEXT OWNER.
* This script must be COPY-TRANS and NO-MOD for NEXT OWNER.
* With permissions correct, this script can't be removed from the prop by end-user.

* Provided as an example only, without any guarantee.
******************************************************************/

string message = "This prop should only be rezzed by the furniture it came with!";

/******************************************************************
* DON'T EDIT BELOW THIS UNLESS YOU KNOW WHAT YOU'RE DOING!
******************************************************************/

default{
    on_rez(integer param){
        if(param==0){
            if(llGetOwner()!=llGetInventoryCreator(llGetScriptName())){
                llRegionSayTo(llGetOwner(),0,message);
                if(llGetAttached()){
                    llRequestPermissions(llGetOwner(),PERMISSION_ATTACH);
                }
                else{
                    llDie();
                }
            }
        }
    }
    run_time_permissions(integer perm){
        if(perm & PERMISSION_ATTACH){
            llDetachFromAvatar();
        }
    }
}
```

## Re-Rez Detached Prop

```js
/******************************************************************
 * Simple example of re-rezzing all attachment props as soon as the avatar detaches them
******************************************************************/

default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90500){
            list data = llParseStringKeepNulls(msg,["|"],[]);
            string EVENT = llList2String(data,0);
            string PROP_NAME = llList2String(data,2);
            if(EVENT == "DETACHED"){
                llMessageLinked(LINK_THIS,90220,PROP_NAME,"");
            }
        }
     }
}
```

## Rez Same Prop for Several Poses

```js
/******************************************************************
* Requires [AV]prop script from box 2.1-07 or later!
*
* This example uses 90220 to rez a prop while any one of a number of poses are playing.
* Useful if you want the same prop to remain rezzed for several poses.
* May help save prop script memory in cases you are re-using the same prop over and over.
*
* To use:
* 1. Set up a regular prop that rezzes with a pose as usual.
*
* 2. Change the PROP's <trigger_name> in the notecard to be a completely new name.
* The new name should *NOT* match a pose name so the prop will rez *ONLY* by this script.
*      e.g. PROP PicnicProp...
*
* 3. Edit the "prop_trigger" string below to match this name.
*      e.g. string prop_trigger = "PicnicProp";
*
* 4. Edit "poses" list below to include all the POSE or SYNC that you want to rez the prop for.
*
* 5. Edit "SITTER" below to match the sitter # the props are for (or use -1 to ignore sitter #).
*
* If you are rezzing props from two or more of these scripts at same time (some poses are in
* more than one script's "poses" list), PROP lines in AVpos notecard must specify different
* <prop_group> for props rezzed by each script. This is necessary because a prop will derez
* when a new prop is rezzed that has the same <prop_group>.
******************************************************************/

string prop_trigger = "PicnicProp";
list poses = ["Sit1","Sit2","cuddle"];
integer SITTER = 0;

/******************************************************************
* DON'T EDIT BELOW THIS UNLESS YOU KNOW WHAT YOU'RE DOING!
******************************************************************/

integer rezzed;

default{
    link_message(integer sender, integer num, string msg, key id){
        if(sender==llGetLinkNumber()){
            if(num==90045){
                list data = llParseStringKeepNulls(msg,["|"],[]);
                string POSE_NAME = llList2String(data,1);
                integer SITTER_NUMBER = (integer)llList2String(data,0);
                key uuid = "";
                if(SITTER!=-1){
                    uuid=id;
                }
                if(SITTER_NUMBER==SITTER || SITTER==-1){
                    if(llListFindList(poses,[POSE_NAME])!=-1){
                        if(rezzed==FALSE){
                            llMessageLinked(LINK_THIS,90220,prop_trigger,uuid);
                            rezzed=TRUE;
                        }
                    }
                    else{
                        llMessageLinked(LINK_THIS,90220,"remprop_"+prop_trigger,uuid); // clear the prop
                        rezzed=FALSE;
                    }
                }
            }
            else if((num==90065 && (integer)msg==SITTER) || num==90030){ //sitter stands or swaps
                rezzed=FALSE;
            }
        }
    }
}
```

## Shared Props by Button

```js
//  Shared props with BUTTON (alpha) v0.01a
//
//  Allows props to be rezzed by button. They won't derez when sitters "swap" or
//  if only one avatar stands up. Requires [AV]prop script from AVsitter2
//  box 2.1-09.01 or later. Shared props should use PROP3 in the AVpos notecard
//  (a special prop type specifically for shared props).
//
//  example use:
//
//  BUTTON myprop|555                           <--- rez the prop
//  BUTTON [CLEAR]|555                          <--- clear all props
//  BUTTON remprop_myprop|555                   <--- derez the prop
//  PROP3 myprop|object|0|<0,0,0><0,0,0>        <--- define the prop (in any SITTER)

default
{
    link_message(integer sender, integer num, string msg, key id)
    {
        if (num != 555) return

        llMessageLinked(LINK_THIS, 90220, "remprop_" + msg, NULL_KEY);      //  remove the prop
        llMessageLinked(LINK_THIS, 90220, msg, NULL_KEY);                   //  rez the prop
        llMessageLinked(LINK_THIS, 90005, "", id);                          //  give back the menu
    }
}
```

## Shared Props by Pose

```js
//  Shared prop script (alpha) v0.04b
//
//  - Allows props to be "shared" i.e. props will rez while any one of a number
//    of POSE/SYNC are playing for any avatar.
//  - Also replaces the need for the "Rez Same Prop for Several Poses" script.
//  - Requires [AV]prop script from AVsitter2 box 2.1-09 or later.
//  - Shared props should use PROP3 in the AVpos notecard (a special prop type
//    specifically for shared props).
//  - Shared props can be set up in SITTER 0 section of the AVpos notecard in a
//    regular setup prim, or in a dedicated rezzer prim.
//  - Props for a specific sitter can use PROP, PROP1 or PROP2.
//  - All props referenced by this script should be named different from pose
//    names (unlike basic props, which do have names that match poses).
//
//  - SITTER_PROPS_N_POSES is your list of SITTER#, PROP names, and
//    POSE/SYNC names the props are for.
//    e.g: 0, "weights", "stand1,stand2"
//  - SITTER with -1 indicates the prop is for all sitters (i.e. shared prop,
//    that should use PROP3 in the AVpos notecard).
//    e.g: -1,"prop1", "sit1,sit2,sit3"
//
//  - "*" for POSE name indicates the prop should rez for all poses.

list SITTER_PROPS_N_POSES = [
        -1, "prop1",   "sit1,sit2,sit3",
        -1, "prop2",   "sit4,sync2",
        -1, "prop3",   "sync1,sync2",
         0, "hat",     "*",
         0, "weights", "weights1,weights2",
         1, "weights", "weights1,weights2"
];


list SITTER_PRIMS;              // which prims have AVsitter setups
list SITTER_POSES_BY_PRIM;      // which poses are playing for each sitter in each prim
list SITTERS_BY_PRIM;           // which sitters are occupied in each setup prim
list REZZED;                    // which props are rezzed, for which avatars
integer ANY_SITTERS;            // if avatars are sitting

rez_derez()
{
    integer i;
    for (; i < llGetListLength(SITTER_PROPS_N_POSES); i += 3)
    {
        integer wasRezzed = llList2Integer(REZZED, i);
        integer forSitter = llList2Integer(SITTER_PROPS_N_POSES, i);
        list    poses     = llParseString2List(llList2String(SITTER_PROPS_N_POSES, i + 2), [","], []);

        integer j;
        for (; j < llGetListLength(poses); j++)
        {
            integer k;
            for (; k < llGetListLength(SITTER_PRIMS); k++)
            {
                list SITTER_POSES_IN_PRIM = llParseStringKeepNulls(llList2String(SITTER_POSES_BY_PRIM, k), ["|"], []);

                integer found = llListFindList(SITTER_POSES_IN_PRIM, [llList2String(poses, j)]);
                if ((~found) || llList2String(poses, j) == "*")
                {
                    list SITTERS_IN_PRIM = llParseStringKeepNulls(llList2String(SITTERS_BY_PRIM, k), ["|"], []);

                    integer l = found;
                    for (; l < llGetListLength(SITTERS_IN_PRIM); l++)
                    {
                        if (forSitter == -1 || forSitter == l)
                        {
                            if ((llList2String(SITTER_POSES_IN_PRIM, l) == llList2String(poses, j) || llList2String(poses, j) == "*") && llList2String(SITTERS_IN_PRIM, l) != "")
                            {
                                if (!llList2Integer(REZZED, i))
                                {
                                    string uuid;
                                    if (forSitter == l)
                                    {
                                        uuid = llList2String(SITTERS_IN_PRIM,l);
                                    }

//                                  llOwnerSay("===REZ====" + llList2String(SITTER_PROPS_N_POSES, i + 1) + "for uuid:" + uuid);

//                                  rez our prop
                                    llMessageLinked(LINK_THIS, 90220, llList2String(SITTER_PROPS_N_POSES, i + 1), uuid);

                                    REZZED = llListReplaceList(REZZED, [TRUE, uuid], i, i + 1);
                                }
                                jump done;
                            }
                        }
                    }
                }
            }
        }
        if (wasRezzed)
        {
            string uuid;
            if (~llList2Integer(SITTER_PROPS_N_POSES, i))
            {
                uuid = llList2String(SITTER_PROPS_N_POSES, i);
            }

//          llOwnerSay("===DEREZ====" + llList2String(SITTER_PROPS_N_POSES, i + 1) + "for uuid:" + uuid);

//          remove our prop
            llMessageLinked(LINK_THIS, 90220, "remprop_" + llList2String(SITTER_PROPS_N_POSES, i + 1), uuid);

            REZZED = llListReplaceList(REZZED, [FALSE], i, i);
        }
        @done;
    }
}

list fill_array(integer x)
{
    list array;

    integer i;
    for (; i < x; i++)
    {
        array += "";
    }

    return array;
}

default
{
    state_entry()
    {
        REZZED = fill_array(llGetListLength(SITTER_PROPS_N_POSES));
    }

    link_message(integer sender, integer num, string msg, key id)
    {
//      if props were cleared with a BUTTON
        if (msg == "[CLEAR]")
        {
            REZZED = fill_array(llGetListLength(SITTER_PROPS_N_POSES));
        }
//      pose played
        else if (num == 90045)
        {
            list    data                 = llParseStringKeepNulls(msg, ["|"], []);
            integer SITTER_NUMBER        = (integer)llList2String(data, 0);
            string  POSE_NAME            = llList2String(data, 1);
            list    SITTERS_IN_PRIM      = llParseStringKeepNulls(llList2String(data, 4), ["@"], []);
            list    LAST_SITTERS_IN_PRIM;
            list    SITTER_POSES_IN_PRIM;

            integer index = llListFindList(SITTER_PRIMS, [sender]);
            if (~index)
            {
                SITTER_POSES_IN_PRIM = llParseStringKeepNulls(llList2String(SITTER_POSES_BY_PRIM, index), ["|"], []);
                SITTER_PRIMS         = llDeleteSubList(SITTER_PRIMS, index, index);
                SITTER_POSES_BY_PRIM = llDeleteSubList(SITTER_POSES_BY_PRIM, index, index);
                LAST_SITTERS_IN_PRIM = llParseStringKeepNulls(llList2String(SITTERS_BY_PRIM, index), ["|"], []);
                SITTERS_BY_PRIM      = llDeleteSubList(SITTERS_BY_PRIM, index, index);

//              if the sitters have swapped, consider any props for the changed sitters derezzed
                integer i;
                for (; i < llGetListLength(LAST_SITTERS_IN_PRIM); i++)
                {
                    if (llList2String(SITTERS_IN_PRIM, i) != llList2String(LAST_SITTERS_IN_PRIM, i))
                    {
                        integer j;
                        for (; j < llGetListLength(SITTER_PROPS_N_POSES); j += 3)
                        {
                            if (llList2Integer(SITTER_PROPS_N_POSES, j) == i)
                            {
                                REZZED = llListReplaceList(REZZED, [FALSE, ""], j, j + 1);
//                              llOwnerSay("rezzed:" + llList2CSV(REZZED));
                            }
                        }
                    }
                }
            }
            else
            {
                SITTER_POSES_IN_PRIM = fill_array(llGetListLength(SITTERS_IN_PRIM));
            }

            SITTER_POSES_IN_PRIM =  llListReplaceList(SITTER_POSES_IN_PRIM, [POSE_NAME], SITTER_NUMBER, SITTER_NUMBER);
            SITTER_PRIMS         += sender;
            SITTER_POSES_BY_PRIM += llDumpList2String(SITTER_POSES_IN_PRIM, "|");
            SITTERS_BY_PRIM      += llDumpList2String(SITTERS_IN_PRIM, "|");

            rez_derez();
        }
//      sitter stands
        else if (num == 90065)
        {
            integer index = llListFindList(SITTER_PRIMS, [sender]);
            if (~index)
            {
                list SITTER_POSES_IN_PRIM = llParseStringKeepNulls(llList2String(SITTER_POSES_BY_PRIM, index), ["|"], []);
                     SITTER_POSES_IN_PRIM = llListReplaceList(SITTER_POSES_IN_PRIM, [""], (integer)msg, (integer)msg);
                     SITTER_POSES_BY_PRIM = llListReplaceList(SITTER_POSES_BY_PRIM, [llDumpList2String(SITTER_POSES_IN_PRIM, "|")], index, index);
                list SITTERS_IN_PRIM      = llParseStringKeepNulls(llList2String(SITTERS_BY_PRIM, index), ["|"], []);
                     SITTERS_IN_PRIM      = llListReplaceList(SITTERS_IN_PRIM, [""], (integer)msg, (integer)msg);
                     SITTERS_BY_PRIM      = llListReplaceList(SITTERS_BY_PRIM, [llDumpList2String(SITTERS_IN_PRIM, "|")], index, index);

                rez_derez();
            }
        }
    }

    changed(integer change)
    {
        if (change & CHANGED_LINK)
        {
            integer IS_SITTER;

//          someone is sitting
            if (llGetAgentSize(llGetLinkKey(llGetNumberOfPrims())) != <0,0,0>)
            {
                IS_SITTER = TRUE;
            }
            else
            {
                SITTER_PRIMS         = [];
                SITTER_POSES_BY_PRIM = [];
                SITTERS_BY_PRIM      = [];
            }

            if (IS_SITTER != ANY_SITTERS)
            {
                ANY_SITTERS = IS_SITTER;

                rez_derez();
            }
        }
    }
}
```

## Show/Hide Prim by Prop Group

```js
/******************************************************************
 * Hide/Show furniture prim when certain <prop_group> is rezzed or derezzed/detached.
 * Place in the prim to hide/show.
 * Uses [AV]prop's 90500 link message.
******************************************************************/

string PROP_GROUP = "GROUP1"; // <prop_group> to hide/show for

default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90500){
            list data = llParseStringKeepNulls(msg,["|"],[]);
            string command = llList2String(data,0);
            string group = llList2String(data,4);

            if(group==PROP_GROUP){
                if(command=="REZ"){ // prop rezzed
                    llSetLinkAlpha(LINK_THIS,0,ALL_SIDES); //hide prim
                }
                else if(command=="DEREZ" || command=="DETACHED"){ // prop derezzed or detached
                    llSetLinkAlpha(LINK_THIS,1,ALL_SIDES); //show prim
                }
            }
        }
    }
}
```

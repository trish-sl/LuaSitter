# AVsitter2 LSL Examples (Advanced)

> **LuaSitter note:** These examples are from the [AVsitter documentation](https://avsitter.github.io). They are LSL scripts and work next to LuaSitter2, because the link messages are unchanged (where a comment mentions an `[AV]` script, read the `[LS]` script). For SLua (Lua) versions of plugin scripts, see [Writing plugins in Lua](../luasitter/lua-plugins.md).

> **Note:** The following LSL script examples are dedicated to the Public Domain under the [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

> **Important:** Please read usage instructions given in the header of each script.

> **Tip:** Visit the [LSL Portal](http://wiki.secondlife.com/wiki/Category:LSL_Functions) for function reference.

## Autoplay

```js
/******************************************************************
* Automatically plays COUPLES_POSE when 2 avatars sit.
* Optionally plays SINGLES_POSE when one avatar stands.
* Requires scripts from box 2.1-11.01 or later.
******************************************************************/

string COUPLES_POSE = "Couples1";
string SINGLES_POSE = ""; //can leave empty

/******************************************************************
 * DON'T EDIT BELOW THIS UNLESS YOU KNOW WHAT YOU'RE DOING!
******************************************************************/

integer IS_SYNC;

default{
   changed(integer change){
        if(change & CHANGED_LINK){
            llSleep(1);
            integer avatar_count = llGetNumberOfPrims() - llGetObjectPrimCount(llGetKey());
            if(avatar_count>1){ // more than one avatar sitting
                if(!IS_SYNC){ // initial avatar had not selected a SYNC pose
                    llMessageLinked(LINK_SET,90000,COUPLES_POSE,""); // play couples pose
                }
            }
            else if(SINGLES_POSE){
                llMessageLinked(LINK_SET,90000,SINGLES_POSE,""); // play singles pose
            }
        }
    }
    link_message(integer sender, integer num, string msg, key id){
        if(num==90045){
            // Extract the data into a list
            list data = llParseStringKeepNulls(msg,["|"],[]);
            // TRUE if the pose is a SYNC pose
            IS_SYNC = (integer)llList2String(data,6);
        }
    }
}
```

## Looped Sound by Button

```js
/******************************************************************
* For most sounds and songs, use the sequence script (http://avsitter.github.io/avsitter2_sequence.html)
*
* This example will loop a sound continuously after a button is pressed in the menu.
* e.g. for switching on a constant sound like a crackling fire in the background.
*
* Prim should contain a sound file that matches "sound".
* or you can use the sound's UUID for "sound" and not have it in the prim.
*
* You'll need to add a button to AVpos notecard that matches the "button_name", either:
* ADJUST Fire Crackle|0 (this will add a button to the [ADJUST] menu).
* or
* BUTTON Fire Crackle|0 (add wherever you like in the menu or a submenu).
******************************************************************/

string button_name = "Fire Crackle";
string sound = "fire_crackle";
float volume = 1.0;

integer playing;

default {
    state_entry(){
        llStopSound(); //stop sounds
    }
    link_message(integer sender, integer num, string msg, key id){
        if(msg==button_name){
            if(playing){
                llStopSound(); //stop sounds
                llRegionSayTo(id,0,"Sound switched off.");
            }
            else{
                llLoopSound(sound,volume); //start looping the sound
                llRegionSayTo(id,0,"Sound switched on.");
            }
            llMessageLinked(LINK_SET,90005,"",id); // give back the menu
            playing=!playing;
        }
    }
}
```

## Move a Prim by Pose

```js
/******************************************************************
* This example will set custom position/rotation of prims with certain poses.
* Only for use in a child prim. Please read comments for information and settings.
******************************************************************/

// DEBUG: if set TRUE then touching the prim will read the prims local position/rotation to chat.
// DEBUG mode allows you to get the data for the DEFAULT and CUSTOM lists below.
// DEBUG should be set to TRUE while you're building and then set to FALSE when you're finished.
integer DEBUG = TRUE;

// SITTER: the SITTER# the script responds to.
integer SITTER = 0;

// Default Position and Rotation of the prim
list DEFAULT = [<0.00000, 0.00000, 1.36389>,<-179.96040, 0.00000, 0.00000>];

// CUSTOM is a list of poses and the custom Position and Rotation for each pose.
// The CUSTOM list is in the format of <pose name>,<prim_position>,<prim_rotation>
// If a pose is not in this list then the position will revert to the DEFAULT.
list CUSTOM = [
    "Pose1",<0.00000, 0.00000, 2.34100>,<-90.00001, 0.00000, 0.00000>,
    "Pose2",<-0.03568, 0.00000, 1.50464>,<-90.00000, 0.00000, 0.00000>,
    "Pose3",<0.14161, 0.88953, 1.97498>,<-151.00680, -4.00000, 0.00000>,
    "Pose4",<0.04294, -0.00032, 2.58356>,<0.00000, 89.98022, -179.98020>
];

// list of poses to ignore SITTER setting and move anyway (e.g. for SYNC poses)
list SYNCS = [];

// DESCRIPTION: if given, then script reacts only to link messages from prim with matching description
string DESCRIPTION = "";

/******************************************************************
 * DON'T EDIT BELOW THIS UNLESS YOU KNOW WHAT YOU'RE DOING!
******************************************************************/

key AVATAR;

default_position(){
    AVATAR=NULL_KEY;
    if(llGetLinkNumber()>1){// only move the prim if the script is in a child prim.
        llSetPrimitiveParams([PRIM_POS_LOCAL,llList2Vector(DEFAULT,0),PRIM_ROT_LOCAL,llEuler2Rot(llList2Vector(DEFAULT,1)*DEG_TO_RAD)]);
    }
}

default{
    state_entry(){
        //default_position();
    }
    link_message(integer sender, integer num, string msg, key id){
        if(DESCRIPTION=="" || llList2String(llGetObjectDetails(llGetLinkKey(sender),[OBJECT_DESC]),0)==DESCRIPTION){//check the sender prim's description
            if(llGetLinkNumber()>1){// only move the prim if the script is in a child prim.
                if (num==90045){ // a pose is played!
                    list data = llParseStringKeepNulls(msg,["|"],[]);
                    integer SITTER_NUMBER = (integer)llList2String(data,0);
                    string POSE_NAME = llList2String(data,1);
                    if(SITTER_NUMBER==SITTER || llListFindList(SYNCS,[POSE_NAME])!=-1){ // correct SITTER or in SYNC list
                        integer index = llListFindList(CUSTOM,[POSE_NAME]);
                        if(index!=-1){ // move prim to a custom position
                            AVATAR = id;
                            llSetPrimitiveParams([PRIM_POS_LOCAL,llList2Vector(CUSTOM,index+1),PRIM_ROT_LOCAL,llEuler2Rot(llList2Vector(CUSTOM,index+2)*DEG_TO_RAD)]);
                        }
                        else{ // move prim to default position
                            default_position();
                        }
                        // llMessageLinked(LINK_THIS,90000,POSE_NAME,(key)((string)SITTER_NUMBER)); // uncomment this line if you are moving the prim that contains the sit script!
                    }
                    else if(id==AVATAR){ // our avatar has swapped sitters.
                        default_position();
                    }
                }
                else if(num==90065 && (integer)msg==SITTER){ // avatar stands up!
                    default_position();
                }
            }
        }
    }
    touch_start(integer touched){
        if(llDetectedKey(0)==llGetOwner() && DEBUG==TRUE){
            if(llGetLinkNumber()>1){
                llOwnerSay((string)llList2Vector(llGetPrimitiveParams([PRIM_POS_LOCAL]),0)+","+(string)(llRot2Euler(llList2Rot(llGetPrimitiveParams([PRIM_ROT_LOCAL]),0))*RAD_TO_DEG));
            }
            else{
                llOwnerSay("This script should only be used in a child prim.");
            }
        }
    }
    changed(integer change){
        if(change & CHANGED_LINK){
            if(llGetAgentSize(llGetLinkKey(llGetNumberOfPrims()))==ZERO_VECTOR){// if no avatars are sitting.
                default_position();
            }
        }
    }
}
```

## Show/Hide Prim by Button

```js
/******************************************************************
* This example will show/hide a prim when a button is pressed in the menu.
* Place this script into the prim you want to make invisible.
*
* You will need a line in the AVpos notecard to create the BUTTON:
* BUTTON Blanket|0
******************************************************************/

string button_name = "Blanket";
integer visible=TRUE;

default {
    state_entry(){
        llSetAlpha(1,ALL_SIDES);//visible
    }
    link_message(integer sender, integer num, string msg, key id){
        if(msg==button_name){
            if(visible){
                llSetAlpha(0,ALL_SIDES);//invisible
            }
            else{
                llSetAlpha(1,ALL_SIDES);//visible
            }
            llMessageLinked(LINK_SET,90005,"",id); // give back the menu
            visible=!visible;
        }
    }
}
```

## Show/Hide Prim by Pose

```js
/******************************************************************
* This example will hide a prim when certain poses are played.
* Place this script into the prim you want to make invisible.
******************************************************************/

// POSES: List of poses we want to make the prim invisible.
list POSES = ["Pose1","Pose2"];

// SITTER: If we only show/hide for a certain SITTER, or use -1 for all sitters.
integer SITTER=-1;

/******************************************************************
 * DON'T EDIT BELOW THIS UNLESS YOU KNOW WHAT YOU'RE DOING!
******************************************************************/

default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90045){
            list data = llParseStringKeepNulls(msg,["|"],[]);
            integer SITTER_NUMBER = (integer)llList2String(data,0);
            if(SITTER==-1 || SITTER==SITTER_NUMBER){
                string POSE_NAME = llList2String(data,1);
                if(llListFindList(POSES,[POSE_NAME])!=-1){
                    llSetAlpha(0,ALL_SIDES);//invisible
                }
                else{
                    llSetAlpha(1,ALL_SIDES);//visible
                }
            }
        }
        else if(num==90065){//sitter stands up
            if(llGetAgentSize(llGetLinkKey(llGetNumberOfPrims()))==ZERO_VECTOR || (integer)msg==SITTER){
                llSetAlpha(1,ALL_SIDES);//visible
            }
        }
    }
}
```

## Show/Hide Prim by Sit

```js
/******************************************************************
* This example will hide a prim whenever an avatar is sitting anywhere on the object.
* Place this script into the prim you want to make invisible.
* Will hide the prim whenever an avatar is sitting. Just swap the llSetAlpha() lines to do the opposite!
******************************************************************/

default{
    changed(integer change){
        if(change & CHANGED_LINK){
            // if no avatars sitting
            if(llGetAgentSize(llGetLinkKey(llGetNumberOfPrims()))==ZERO_VECTOR){
                //make prim visible
                llSetAlpha(1,ALL_SIDES);
            }
            // if avatars are sitting
            else{
                //make prim invisible
                llSetAlpha(0,ALL_SIDES);
            }
        }
    }
}
```

## Show/Hide Prim by SitTarget

```js
/******************************************************************
* This example will hide a prim whenever an avatar is sitting on the prim the script is in.
* Place this script into the prim you want to make invisible.
******************************************************************/

default{
    changed(integer change){
        if(change & CHANGED_LINK){
            if(llAvatarOnSitTarget() == NULL_KEY){
                llSetAlpha(1,ALL_SIDES);//visible
            }
            else{
                llSetAlpha(0,ALL_SIDES);//invisible
            }
        }
    }
}
```

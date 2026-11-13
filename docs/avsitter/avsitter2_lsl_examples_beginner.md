# AVsitter2 LSL Examples (Beginner)

> **LuaSitter note:** These examples are from the [AVsitter documentation](https://avsitter.github.io). They are LSL scripts and still work next to LuaSitter, because the link messages are unchanged (where a comment mentions an `[AV]` script, read the `[LS]` script). For SLua (Lua) versions of plugin scripts, see [Writing plugins in Lua](../luasitter/lua-plugins.md).


> **Note:** The following LSL script examples are dedicated to the Public Domain under the [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
> **Important:** Please read usage instructions given in the header of each script.
> **Tip:** Visit the [LSL Portal](http://wiki.secondlife.com/wiki/Category:LSL_Functions) for function reference.

## Button Gives Folder

```js
/******************************************************************
* This example will give items in a folder when a BUTTON is pressed
* You will need a line in the AVpos notecard to create the BUTTON:
* e.g. BUTTON Give Items|0
******************************************************************/

string button = "Give Items";
list items = ["Item1","Item2","Item3"];
string foldername = "Object Folder";

default{
    link_message(integer sender, integer num, string msg, key id){
        if(msg==button){
            llGiveInventoryList(id,foldername,items);
        }
    }
}
```

## Button Gives Multiple Items

```js
/******************************************************************
* This example will give different objects to an avatar who presses different BUTTON in the menu
* You will need a line in the AVpos notecard for each BUTTON
* e.g. BUTTON Coffee|0
******************************************************************/

default{
    link_message(integer sender, integer num, string msg, key id){
        if(msg=="Coffee"){
            llGiveInventory(id,"Coffee Cup");
        }
        else if (msg=="Donut"){
            llGiveInventory(id,"donut");
        }
        else if (msg=="Lunch"){
            llGiveInventory(id,"Lunchbox");
        }
        else if (msg=="Pastry"){
            llGiveInventory(id,"coconut swirl");
        }
    }
}
```

## Button Gives Single Item

```js
/******************************************************************
* This example will give an object to an avatar who presses a BUTTON in the menu
* You will need a line in the AVpos notecard to create the BUTTON:
* e.g. BUTTON Coffee|0
******************************************************************/

string button = "Coffee";
string itemname = "Coffee Cup";

default{
    link_message(integer sender, integer num, string msg, key id){
        if(msg==button){
            llGiveInventory(id,itemname);
        }
    }
}
```

## Custom Greeting

```js
/******************************************************************
* This example will send a greeting message to each new sitter
******************************************************************/

default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90060){
            llSay(0,"Welcome, "+llKey2Name(id));
        }
        else if(num==90065){
            llSay(0,"Goodbye, "+llKey2Name(id));
        }
    }
}
```

## Message Pose Names

```js
/******************************************************************
* This example will send a message to the avatar each time a pose plays
******************************************************************/

default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90045){
            list data = llParseStringKeepNulls(msg,["|"],[]);
            string POSE_NAME = llList2String(data,1);
            llRegionSayTo(id,0,"Playing pose "+POSE_NAME);
        }
    }
}
```

## Pose Gives Folder of Items

```js
/******************************************************************
* This example will give items in a folder when a specific pose plays
******************************************************************/
string posename = "Propose";
list items = ["Flowers","Ring"];
string foldername = "Proposal Gear";

// SITTER: Specify the SITTER # or leave as -1 for all SITTER's
integer SITTER = -1;

default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90045){
            list data = llParseStringKeepNulls(msg,["|"],[]);
            integer SITTER_NUMBER = (integer)llList2String(data,0);
            if(SITTER_NUMBER==SITTER || SITTER==-1){
                if(llList2String(data,1)==posename){
                    llSleep(2);
                    llGiveInventoryList(id,foldername,items);
                }
            }
        }
    }
}
```

## Pose Gives Multiple Items

```js
/******************************************************************
* This example will give different items to inventory when poses play
******************************************************************/

// SITTER: Specify the SITTER # or leave as -1 for all SITTER's
integer SITTER = -1;

default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90045){
            list data = llParseStringKeepNulls(msg,["|"],[]);
            integer SITTER_NUMBER = (integer)llList2String(data,0);
            string POSE_NAME = llList2String(data,1);
            if(SITTER_NUMBER==SITTER || SITTER==-1){

                // When 'Eat Cake' pose is played, give 'Cake'.
                if(POSE_NAME=="Eat Cake"){
                    llGiveInventory(id,"Cake");
                }

                // When 'Drink Coffee' pose is played, give 'Coffee'.
                else if(POSE_NAME=="Drink Coffee"){
                    llGiveInventory(id,"Coffee");
                }

                // When 'Dine' pose is played, give 'Knife' and 'Fork'.
                else if(POSE_NAME=="Dine"){
                    llGiveInventory(id,"Knife");
                    llGiveInventory(id,"Fork");
                }

            }
        }
    }
}
```

## Pose Gives Single Item

```js
/******************************************************************
* This example will give a single item to the avatar when a specific pose plays
******************************************************************/
string posename = "Eat Cake";
string itemname = "Cake";

// SITTER: Specify the SITTER # or leave as -1 for all SITTER's
integer SITTER = 0;

default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90045){
            list data = llParseStringKeepNulls(msg,["|"],[]);
            integer SITTER_NUMBER = (integer)llList2String(data,0);
            string POSE_NAME = llList2String(data,1);
            if(SITTER_NUMBER==SITTER || SITTER==-1){
                if(POSE_NAME==posename){
                    llGiveInventory(id,itemname);
                }
            }
        }
    }
}
```

## Pose Gives Chat Message

```js
/******************************************************************
* This example will send a chat message when a specific pose plays
******************************************************************/

string posename = "Eat Cake";
string message = "Eating Cake! Yum Yum!";

default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90045){
            list data = llParseStringKeepNulls(msg,["|"],[]);
            string POSE_NAME = llList2String(data,1);
            if(POSE_NAME==posename){
                llSay(0,message);
            }
        }
    }
}
```

## Simple Colorchange Example

```js
/******************************************************************
* This example will change color when a BUTTON is selected.
* Your AVpos notecard should have buttons for each color e.g.
*
* TOMENU Colors
* ...
* MENU Colors
* BUTTON Red|0
* BUTTON White|0
* BUTTON Blue|0
*
* This is a basic example to show concept only.
* If you need custom texture change you should contact your scripter.
******************************************************************/

list  COLOR_NAMES = ["Red","White","Blue"];
list  COLOR_VECTORS = [<1,0,0>,<1,1,1>,<0,0,1>];

default{
    link_message(integer sender, integer num, string msg, key id){
        integer index = llListFindList(COLOR_NAMES,[msg]);
        if(~index){ // color button was pressed
            if(id==llGetOwner()){ // it was owner
                llSetColor(llList2Vector(COLOR_VECTORS,index),ALL_SIDES);
            }
            else{ // it was not owner
                llRegionSayTo(id,0,"Sorry this is owner only.");
            }
            // give back the menu
            llMessageLinked(LINK_SET,90005,"",id);//return menu
        }
    }
}
```

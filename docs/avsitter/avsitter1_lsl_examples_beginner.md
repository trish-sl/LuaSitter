# AVsitter1 LSL Examples (Beginner)

> **LuaSitter note:** These examples are from the [AVsitter documentation](https://avsitter.github.io). They are LSL scripts and still work next to LuaSitter, because the link messages are unchanged (where a comment mentions an `[AV]` script, read the `[LS]` script). For SLua (Lua) versions of plugin scripts, see [Writing plugins in Lua](../luasitter/lua-plugins.md).


> **Note:** The following LSL script examples are dedicated to the Public Domain under the [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
> **Important:** Please read useage instructions given in the header of each script.
> **Tip:** Visit the [LSL Portal](http://wiki.secondlife.com/wiki/Category:LSL_Functions) for function reference.

## Basic Color Change

```js
/******************************************************************
* This AVsitter™ example will change color when a BUTTON is selected.
* Your AVpos notecard should have buttons for each color e.g.
*
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
                if(index!=-1){
                        llSetColor(llList2Vector(COLOR_VECTORS,index),ALL_SIDES);
                        llMessageLinked(LINK_SET,90005,"",id);//return menu
                }
        }
}
```

## Custom Greeting

```js
/******************************************************************
* This AVsitter™ example will IM a custom greeting to each new sitter
* Place a single copy in any prim in the object
******************************************************************/
default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90060){
            llInstantMessage(id,"Welcome!");
        }
        else if(num==90065){
            llInstantMessage(id,"Goodbye!");
        }
    }
}
```

## Pose Gives Folder

```js
/******************************************************************
* This AVsitter™ example will give items in a folder with a pose
* Note that the "S:" is required at start of the posename to detect a SYNC pose
******************************************************************/
string posename = "PaintNails";
list items = ["Bottle","Brush"];
string foldername = "NailPolish Folder";

default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90055){
            if(msg==posename){
                llSleep(2);
                llGiveInventoryList(id,foldername,items);
            }
        }
    }
}
```

## Button Gives Folder

```js
/******************************************************************
* This AVsitter™ example will give items in a folder when a button is pressed
* You will need a line in the AVpos notecard to create the Button:
* e.g. "BUTTON Give Items|0"
******************************************************************/
string button = "Give Items";
list items = ["Item1","Item2","Item3"];
string foldername = "Object Folder";

default{
    link_message(integer sender, integer num, string msg, key id){
        if(msg==button){
            llMessageLinked(LINK_SET,90005,"",id); //optional to give the person the menu
            llSleep(2); //a pause
            llGiveInventoryList(id,foldername,items);
        }
    }
}
```

## Button Gives Item

```js
/******************************************************************
* This AVsitter™ example will give the object "Coffee Cup" to the avatar
* who clicks the button "Coffee" from the menu
* Place the script in any prim in the object with an object named "Coffee Cup"
* You will need a line in the AVpos notecard to create the Button:
* e.g. "BUTTON Coffee|0"
******************************************************************/
default{
    link_message(integer sender, integer num, string msg, key id){
        if(msg=="Coffee"){
            llMessageLinked(LINK_SET,90005,"",id); //optional to give the person the menu
            llSleep(2); //a pause
            llGiveInventory(id,"Coffee Cup");
        }
    }
}
```

## Pose Gives Item

```js
/******************************************************************
* This AVsitter™ example will give items with a pose
* Note that the "S:" is required to detect the SYNC pose
******************************************************************/
default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90055){
            llSleep(2); //a pause
            if(msg=="Drink"){
                llGiveInventory(id,"Coffee Cup");
            }
            else if(msg=="Brush"){
                llGiveInventory(id,"Hair Brush");
            }
        }
    }
}
```

## Perform any Script Action with a Pose

```js
/******************************************************************
* This AVsitter™ example will perform actions with specific poses
* Note that the "S:" is required to detect the SYNC pose
******************************************************************/
default{
    link_message(integer sender, integer num, string msg, key id){
        if(num==90055){
            if(msg=="Sit1"){
                llSay(0,"Sit1 selected!");
            }
            else if(msg=="Sit2"){
                llSay(0,"Sit2 selected!");
            }
            else if(msg=="S:Couples1"){
                llSay(0,"Couples1 selected!");
            }
        }
    }
}
```

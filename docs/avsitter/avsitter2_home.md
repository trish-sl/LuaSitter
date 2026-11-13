# AVsitter2

> **LuaSitter note:** This page is from the [AVsitter documentation](https://avsitter.github.io) (CC BY-SA 4.0, see [LICENSE](../LICENSE.md)), adapted for LuaSitter. Everything here applies to LuaSitter2: the AVpos notecard format and the link messages are unchanged. LuaSitter also reads the notecard under its new name, `LSpos` (preferred for new furniture). Script names differ: `[AV]name` is `[LS]name` in LuaSitter, and `[AV]sitA` + `[AV]sitB` are one script, `[LS]sit`. See [Migrating from AVsitter](../luasitter/migrating-from-avsitter.md) and the [LuaSitter notes](#luasitter-notes) at the end of this page.

## How to get AVsitter2

AVsitter2 can be freely obtained from GitHub and imported into Second Life by following our [import guide](https://github.com/AVsitter/AVsitter/blob/master/AVsitter2/IMPORT_GUIDE.md).

> **Tip:** If you would prefer a packaged version of the latest release, and to receive in-world updates of future releases, visit the [SL Marketplace](https://marketplace.secondlife.com/stores/79645) or [Kitely Market](https://www.kitely.com/market?store=15535242). Proceeds from marketplace sales are shared with open-source contributors and help support continued development.

## Inside the AVsitter2 Package

The main AVsitter package contains:

-  **[AV]sitA & [AV]sitB scripts**

   The main scripts that must always be used in a pair (A+B), one pair for each avatar to sit. Each pair will define a SITTER.

-  **[AV]adjuster script & [AV]helper object**

   These are setup items that allow the default pose positions to be adjusted.

-  **AVpos notecard**

   AVsitter data needs to be saved in an AVpos notecard. The notecard provided is intentionally empty.

-  **Examples [BOX]**

   The AVsitter Examples [BOX] contains [several example items](avsitter2_examples.md) that demonstrate the use of the system. The imprtance of the examples is often overlooked. Please examine the examples closely to understand how the system can be used for different setups.

-  **Utilities [BOX]**

   The Utilities [BOX] contains the [Utilities](avsitter2_utilities.md).

-  **Plugins [BOX]**

   The Plugins [BOX] contains scripts that provide special functionality, along with [examples](avsitter2_examples.md). Example items are provided for each script.

## Requirements

There are some basic requirements to use AVsitter:

<ul>
<li/>You will need to have a beginner's [knowledge of building in Second Life](http://wiki.secondlife.com/wiki/Building_Tools).
<li/>You will need to purchase animation files from [animation stores in SL](http://bit.ly/HtdEqK) or [learn to create them yourself](http://wiki.secondlife.com/wiki/How_to_create_animations).</ul>

## Setup

### Basic Prim Setup

The most basic setup is a prim that seats one avatar.

<ol>
<li/>Drop the following into an empty prim in your furniture:

<ul>
<li/>[AV]sitA + [AV]sitB scripts
<li/>[AV]adjuster script
<li/>[AV]helper object
<li/>AVpos notecard
<li/>The animation files you plan to use
</ul>
> **Note:** One pair of [AV]sit (A+B) scripts will mean the prim has _one_ SITTER.

<li/>Sit on your furniture, and the menu will appear (if you lose the menu just touch your furniture again to get the menu back).

<li/>Choose [ADJUST] then [HELPER] from the menu, and the [AV]helper stick will rez.

<li/>Choose [NEW] from the menu, then choose [POSE] to create a singles pose.

<li/>After creating a pose, adjust its position by moving the helper stick with the SL building tools until your avatar is in the correct position. Click [SAVE] for each pose you create before moving on to the next.

<li/>When you have finished saving all your poses, click [DUMP] to output your settings into chat.

> **Note:** If you use a translator, turn it off before pressing [DUMP].

<li/>Copy-paste the [DUMP] result into your AVpos notecard, replacing the contents of the notecard.

> **Note:** A web link is now given as a link at the end of the settings [DUMP], which is more reliable than copying from SL chat. (LuaSitter: there is no web link; the settings are printed in chat only. See the [LuaSitter notes](#luasitter-notes).)

<li/>If required, you can rez the [HELPER] again and add more poses.

<li/>To add poses to other prims in your object, simply repeat the process.
</ol>
  

> **Important:** When you [DUMP] you'll see the diamond character (&diams;) on every line. All text on a notecard line before the diamond is ignored by the script. This allows you to copy-paste chat output directly into your notecard without having to remove the timestamp from every line. If you remove the timestamps from your notecard then you can safely remove the diamonds.

> **Tip:** Once setup is complete, you can (optionally) remove the [AV]helper and [AV]adjuster from your furniture. Leaving them in will allow the next owner to modify and [SAVE] the default pose positions (although they will not have access to [DUMP] or [NEW] unless they are an AVsitter2 owner). (LuaSitter: there is no such restriction. A customer who keeps `[LS]adjuster` can also use [NEW] and [DUMP], and is told on rez that they can use it.)

  

**Basic Setup Video**

<iframe height="349" src="https://www.youtube.com/embed/Oie421iU1P8?rel=0" frameborder="0" width="560" allowfullscreen=""></iframe>

> **Tip:** If English is not your language, the videos have captions for automatic translation.

### Couples Prim Setup

Setup of a prim for multiple avatars is the same as for [Basic Prim Setup](avsitter2_home.md#basic-prim-setup), with a few additions:

<ol>
<li/>Your object must have a prim count equal to or greater than the number of avatars you plan on sitting.

<li/>You will need to drop one pair of [AV]sit (A+B) scripts into the prim _for each avatar you want to sit_.
i.e. For 2 sitters you'll need 2 pairs of [AV]sit (A+B) scripts.

> **Note:** SL should automatically name your scripts sequentially when you drop them in together. Please make sure it does this correctly, as the names must be sequential. i.e. [AV]sitA, [AV]sitA 1, [AV]sitB, [AV]sitB 1

<li/>In the [NEW] menu, choosing [POSE] will create a singles pose and choosing [SYNC] will create a couples pose.

> **Note:** Choosing [POSE] will add a singles POSE only to the menu of the SITTER _you are on_. Press [SWAP] first if you need to move to a different SITTER's menu before adding the pose. The active SITTER # is listed in the menu.

> **Note:** Choosing [SYNC] will add a SYNC pose to the menu of _multiple SITTERs_ (e.g. SITTER 0 and SITTER 1).

> **Important:** Singles poses should be positioned so that they do not overlap the positions set for other sitters. e.g. SITTER 0 poses on left-hand side of the furniture, and SITTER 1 on right-hand side.

> **Important:** The first pose in each SITTER is the default pose for the seat. Even in couples furniture, you should usually make the first pose in each SITTER's menu a singles POSE.

</ol>
  

**Couples Setup Video**

<iframe height="349" src="https://www.youtube.com/embed/A0O83Y8zqUw?rel=0" frameborder="0" width="560" allowfullscreen=""></iframe>

> **Tip:** If English is not your language, the videos have captions for automatic translation.

### Submenus

To create a submenu...

<ol>
<li/>In the [NEW] menu, choose [SUBMENU]. This will create a submenu only in the menu of the SITTER you are on.
<li/>Navigate to your submenu and then create new [POSE], [SYNC], or [SUBMENU] inside the submenu.
</ol>

> **Note:** [SUBMENU] will only add to the menu of the SITTER you are on. If want to have the same submenu in another SITTER's menu, you will need to press [SWAP] to move to the other SITTER and create the submenu there too.

> **Important:** If adding a [SYNC] pose, the pose will be added to whichever submenu was last selected. This applies separately to each SITTER's menu. You will need to press [SWAP] to move to the other SITTER and create/select the submenu there too.

> **Important:** Adding poses to submenus via the [NEW] menu is for beginners. You can create, re-order, rename, delete submenus by learning the TOMENU and MENU commands covered in the [Notecard Section](avsitter2_avpos.md).

### Camera

To save a camera position...

<ol>
<li/>In the [NEW] menu, choose [CAMERA] then [SAVE]. This will save your camera view for all sitters in the prim.
<li/>To remove all camera settings from the object, choose [CAMERA] then [CLEAR].
<li/>Changes to camera settings will take effect the next time you sit.
</ol>

> **Note:** The camera setting is a prim property and does not require anything to be placed in the AVpos notecard.

> **Warning:** For camera settings in multiple prims, be aware of JIRA [BUG-5494](https://jira.secondlife.com/browse/BUG-5494).

> **Note:** If you need a different camera position for each pose, see information for the [[AV]camera script](avsitter2_camera.md) instead.

### Chat Commands

The following chat commands can be typed into local chat while the [AV]adjuster and [AV]helper are in the furniture:

<ul>
<li/>/5 helper - rezzes the helpers (alternate to using menu).

<li/>/5 cleanup - deletes the [AV]adjuster & [AV]helper from the prim.

<li/>/5 &lt;avatar uuid&gt; - moves the helper into the exact position of another avatar. Useful for copying positions from poseballs.

<li/>/5 targets - briefly shows the [SitTargets](avsitter2_sittargets.md) in hovertext.</ul>

### Making Corrections

If you do not get things right the first time, you can always make corrections or additions:

<ul>
<li/>To change the position of a pose, or to add new poses, you can always select [HELPER] again, position the pose, and [SAVE]. Remember to [DUMP] your settings again and save them to the AVpos notecard after making any changes.

<li/>If you want to rename or change the order of any menu items you can manually edit [the AVpos notecard](avsitter2_avpos.md).

<li/>To delete a pose, you must manually remove the lines from the [the AVpos notecard](avsitter2_avpos.md).

<li/>As with all building in SL, you should take a backup of your work regularly to avoid losing progress.

</ul>

## Advanced Setup

The [NEW] menu described on this page is a great way to start using AVsitter, however you will have much more control when you learn to edit the notecard manually. After you can follow the tutorials on this page you should then learn the format of the [AVpos notecard](avsitter2_avpos.md) and learn about the [utility scripts](avsitter2_utilities.md). Advanced users can then consider [custom scripting](avsitter2_scripting.md) or one of the available plugins.

### Multiple Setups

It is possible to have any mix of singles & couples setups in different prims of the same furniture, however you must follow the instructions given in the [SitTargets section](avsitter2_sittargets.md).

### Setups for 3+ Avatars

Setups in one prim for 3+ avatars is the same as for [couples setup](avsitter2_home.md#couples-prim-setup) but needs to include more pairs of [AV]sit (A+B) scripts. The [NEW] menu will allow you to add a SYNC pose for multiple SITTERs but you should also learn to add/edit poses [manually in the notecard](avsitter2_avpos.md).

> **Note:** If your furniture does not include SYNC poses you could instead set each avatar's poses in separate prims. e.g. a table with 4 chairs around would usually be best with a singles setup in each chair, rather than 4 SITTERs in one.

> **Warning:** There is no set limit but it's not recommended to have more than 6 SITTERs in the same prim.

### Animation Sequences

AVsitter provides two ways to do sequences: the [AVsequence&trade;](avsitter2_sequence.md) script and the ["built-in" sequence](avsitter2_avpos.md#built-in-animation-sequence) method. Read about both and use the method most appropriate for your situation.

### Sounds and Songs

Playing sound files is achieved with the [AVsequence&trade;](avsitter2_sequence.md) script (includes playing a single sound with a pose, or a complete song).

## LuaSitter notes

- **Scripts:** use `[LS]sit` where this page says `[AV]sitA` and `[AV]sitB`. LuaSitter has no separate memory script, so a 2-sitter setup has `[LS]sit` and `[LS]sit 1` (2 scripts instead of 4).
- **Installing:** create each script in-world with its exact name and select **Lua** in the script editor's compiler drop-down before pasting the `.luau` code. The AVsitter2 package, examples box and in-world updater mentioned above are AVsitter products, not part of LuaSitter.
- **Remove the adjuster:** `[LS]adjuster` and the helper are setup tools. Delete them before selling or giving the furniture if customers should not edit poses (type `/5 cleanup`). `[LS]adjuster` reminds the creator in chat each time the object is rezzed. They may also stay: a customer who owns the furniture is told they can use them to adjust, add and save poses.
- **Plugins:** `[AV]prop`, `[AV]sequence` and `[AV]favs` are one script, `[LS]plugins`; `[AV]faces` and `[AV]camera` are `[LS]faces-camera`.
- **Helper:** the helper object can be named `[LS]helper` (with `[LS]helperscript` inside). Existing `[AV]helper` objects also work.
- **DUMP:** the settings are printed in chat only. LuaSitter does not upload a web copy, so there is no "Settings copy" link. DUMP is also much faster than in AVsitter2.
- **Loading:** notecards load almost instantly when the simulator has them cached (`ll.GetNotecardLineSync`).

# About SitTargets

> **LuaSitter note:** This page is from the [AVsitter documentation](https://avsitter.github.io) (CC BY-SA 4.0, see [LICENSE](../LICENSE.md)), adapted for LuaSitter. Everything here applies to LuaSitter2: the AVpos notecard format and the link messages are unchanged. LuaSitter also reads the notecard under its new name, `LSpos` (preferred for new furniture). Script names differ: `[AV]name` is `[LS]name` in LuaSitter, and `[AV]sitA` + `[AV]sitB` are one script, `[LS]sit`. See [Migrating from AVsitter](../luasitter/migrating-from-avsitter.md) and the [LuaSitter notes](#luasitter-notes) at the end of this page.

To sit on an object in SL, the object must have an available SitTarget. Each prim in an object can only have one SitTarget and when an avatar sits on a prim, the avatar will occupy that SitTarget. AVsitter's default is to assign avatars to SITTERs in the order they sit. The first avatar to sit will be assigned to SITTER 0 and the second avatar to sit will be assigned to SITTER 1.

> **Note:** An [AV]sit (A+B) pair of scripts defines a SITTER, which is the seat and menu for one avatar.

> **Note:** For most setups, AVsitter automatically assigns SitTargets as required. You only need to understand this section if you have [Multiple Setups](avsitter2_home.md#multiple-setups) in your furniture, or if you want to allow avatars to target a certain prim to sit on a specific SITTER.

> **Warning:** Your furniture must *always* have a prim count greater than or equal to the number of avatars you plan on sitting.

## Assigning SitTargets (special/advanced only)
AVsitter's default is to assign avatars to SITTERs in the order they sit, but you can override it:

- If you want to allow avatars to target a specific SITTER when they sit on a certain prim (e.g. cushion).
- When your object contains multiple setup prims that include at least one couples setup.
- To reserve the SitTarget on a certain prim for use by another script (e.g. vehicle's driver script).

AVsitter will assign SitTargets to prims using the following method:

- If there is only one SITTER in the prim, AVsitter assigns the SitTarget to that prim.
- If there is more than one SITTER in the prim (e.g. couples), AVsitter assigns SitTargets starting with the root prim, followed by prim 2, 3, etc of the furniture...

To override the default behavior:

1. Assign [a SET #](avsitter2_avpos.md#set) in the AVpos notecard.
2. Assign each SITTER to a prim by typing the SET # and SITTER # into the description of the prim you want to assign that SITTER to, separated by a dash (-). e.g:
    - To assign the SitTarget for SET 0, SITTER 0 to a prim, type 0-0 into the description of that prim.
    - To assign the SitTarget for SET 0, SITTER 1 to a prim, type 0-1 into the description of that prim.
    - To assign the SitTarget for SET 1, SITTER 1 to a prim, type 1-1 into the description of that prim.

    note: You must choose prims that are **distinctly separate and obvious places** for an avatar to sit.

3. Repeat for all setups in the furniture that are for more than one avatar.
4. Unlink and re-link the object or reset scripts for your changes to take effect.

> **Important:** See Examples #02b, #04 & #10a in the AVsitter Examples [BOX] (separate prims are assigned to each SITTER).

> **Important:** If you assign SitTargets or SET #'s you should do so for all SITTERS in every setup that is for more than one avatar.

> **Note:** With the [AV]adjuster script in the prim, you can type **/5 targets** in chat to briefly show the SitTargets in hovertext.

> **Important:** If you need to use the prim description for another script, you can place the AVsitter bit after a #. e.g. **tablecloth#0-0**.

### Assigning SitTargets Video

<iframe height="349" src="https://www.youtube.com/embed/RYqGKGk21D8?rel=0" frameborder="0" width="560" allowfullscreen=""></iframe>

### SitTargets and Multiple Setups
If you have [Multiple Setups](avsitter2_home.md#multiple-setups) in your furniture then you must [assign a unique SET #](avsitter2_avpos.md#set) to each setup that is for more than one avatar. e.g. If you have 2 separate couples setups in the same furniture, type SET 0 into the notecard of one and SET 1 into the notecard of the other. You would then need to [Assign a SitTarget](avsitter2_sittargets.md#assigning-sittargets-specialadvanced-only) in prim descriptions for each SITTER in those setups.

> **Important:** See AVsitter Example#09 in the AVsitter Examples [BOX] (example shows a couch with couples and 3 singles prims).

> **Important:** See AVsitter Example#10b in the AVsitter Examples [BOX] (example shows a couch with multiple couples prims).

### SitTargets and Multiple Setups Video

<iframe height="349" src="https://www.youtube.com/embed/KilhfAQsrY4?rel=0" frameborder="0" width="560" allowfullscreen=""></iframe>

### Reserving SitTargets
AVsitter places and removes SitTargets automatically throughout the object, but you might want to override this:

- For a vehicle's driver seat _which has its own animations_ in the vehicle script.
- If you are using a different sit script in one of the prims.

To reserve the SitTarget of a specific prim, use -1 in that prim's description. Remember to re-link the object for changes to take effect.

After adding -1 to a prim's description you should reset your own scripts inside the prim, to ensure those scripts replace their own SitTargets.

If your use of AVsitter includes any prims for multiple sitters then you will also need to follow the instructions for [SitTargets and Multiple Setups](avsitter2_sittargets.md#sittargets-and-multiple-setups) as described above (assigning a SET # to each setup and assigning the SitTargets in prim descriptions).

> **Important:** See the vehicle setup examples provided in the AVsitter Examples [BOX].

As an alternate to placing -1 in the prim description you can add a custom script to the prim that uses the 90150 link message to replace the SitTarget in the prim when required. e.g:

```js
default
{
    link_message(integer sender, integer num, string msg, key id)
    {
        if(num == 90150)
        {
            llSitTarget(<0,0,0.1>, ZERO_ROTATION);
        }
    }
}
```

### Reserving SitTargets Video

<iframe height="349" src="https://www.youtube.com/embed/zRD_Uwenh6c?rel=0" frameborder="0" width="560" allowfullscreen=""></iframe>

## LuaSitter notes

- Sit targets work exactly as described here. Where this page mentions an [AV]sit (A+B) pair of scripts, use one `[LS]sit` script (`[LS]sit`, `[LS]sit 1`, ...).
- `/5 targets` works the same with `[LS]adjuster`.

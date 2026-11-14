# AVcamera

> **LuaSitter note:** This page is from the [AVsitter documentation](https://avsitter.github.io) (CC BY-SA 4.0, see [LICENSE](../LICENSE.md)), adapted for LuaSitter. Everything here applies to LuaSitter2: the AVpos notecard format and the link messages are unchanged. LuaSitter also reads the notecard under its new name, `LSpos` (preferred for new furniture). Script names differ: `[AV]name` is `[LS]name` in LuaSitter, and `[AV]sitA` + `[AV]sitB` are one script, `[LS]sit`. See [Migrating from AVsitter](../luasitter/migrating-from-avsitter.md) and the [LuaSitter notes](#luasitter-notes) at the end of this page.

## [AV]camera script
The [AV]camera script allows creators to set the camera position for each pose.

Please note AVsitter also has a [built-in camera setting](avsitter2_home.md#camera) that can set the camera prim property. Only use the [AV]camera script if you need different camera settings for different poses, or want to set different camera positions chosen by menu button.

> **Important:** The [AV]camera script is provided in the Plugins [BOX].

### Adding Camera Settings
To add camera settings to your furniture, start with the [normal setup](avsitter2_home.md#setup) procedure, then:

- Ensure the [AV]helper and [AV]adjuster are in the prim.
- Drop an [AV]camera script into the prim for <ins>each</ins> sitter. If your furniture is for 2 avatars you'll need 2 x [AV]camera scripts.
- Sit on the furniture, then choose a pose from the menu that you want to add a camera setting to.
- Choose [ADJUST] then [HELPER] from the menu, and the [AV]helper stick will rez.
- Choose [NEW] from the menu, then choose [CAMERA] and select [SAVE].
- Repeat for each pose you want to give a camera setting.
- When you have finished adding all your camera settings, click [DUMP] to output your settings into chat.
- Copy-paste the [DUMP] result into your AVpos notecard, replacing the contents of the notecard.

> **Important:** Camera settings are defined separately for each SITTER.

### Notecard Commands
You can edit the notecard to add/remove camera settings.

The format for the notecard is:

    CAMERA <trigger_name>|<camera_position>|<camera_rotation>

&lt;trigger_name&gt; must match the menu name of the pose that you want to trigger the camera setting.

&lt;camera_position&gt; & &lt;camera_rotation&gt; are relative to the prim.

e.g.

    CAMERA Sit1|<-0.02579, -2.34928, 1.61621>|<-0.00772, -1.49104, 1.10328>

You can set a camera setting to be the default for all poses by renaming its &lt;trigger_name&gt; to DEFAULT (uppercase).

e.g.

    CAMERA DEFAULT|<-0.02579, -2.34928, 1.61621>|<-0.00772, -1.49104, 1.10328>

### Example Notecard

```
SITTER 0

POSE Sit1|animation1
POSE Sit2|animation2

SYNC Couples1|fm-close
SYNC Couples2|fm-entwine

{Sit1}<-0.602898, -0.421242, 0.912842><0.000000, 0.000000, -90.000000>
{Sit2}<-0.587479, -0.368538, 0.921997><0.000000, 0.000000, -90.000000>
{Couples1}<-0.005249, -0.308144, 0.588623><17.819780, 4.447547, -79.985590>
{Couples2}<0.296906, -0.491043, 0.279114><0.000000, 0.000000, 90.000000>

CAMERA DEFAULT|<-0.09605, -2.75508, 1.23718>|<-0.07217, -1.81931, 0.88538>
CAMERA Sit1|<0.12466, -1.65931, 3.34216>|<0.12805, -1.20604, 2.45079>

SITTER 1

POSE Sit1|animation1
POSE Sit2|animation2

SYNC Couples1|ml-close
SYNC Couples2|ml-entwine

{Sit1}<0.583901, -0.419540, 0.944092><0.000000, 0.000000, -90.000000>
{Sit2}<0.531426, -0.368042, 0.924500><0.000000, 0.000000, -90.000000>
{Couples1}<0.066849, -0.461144, 0.367737><17.819780, 4.447547, -79.985590>
{Couples2}<0.158402, -0.460144, 0.355591><0.000000, 0.000000, 90.053870>

CAMERA DEFAULT|<-0.09605, -2.75508, 1.23718>|<-0.07217, -1.81931, 0.88538>
CAMERA Sit2|<0.12466, -1.65931, 3.34216>|<0.12805, -1.20604, 2.45079>
```

> **Important:** If you want the user to select camera position with menu buttons then see [here](http://avsitter.com/qa/939).

> **Important:** Remember that if your camera is already focused somewhere, you won't see the camera change. You need to first release the camera by hitting the ESC key. If this doesn't work, hit ESC again. The reason is that if you had, for example, the focus on the chat window, the first ESC will release the focus from it, while the second ESC will actually release the camera.

## LuaSitter notes

- Cameras and facial expressions are one script in LuaSitter: `[LS]faces-camera`. Use one copy per sitter for cameras (`[LS]faces-camera`, `[LS]faces-camera 1`, ...), as with `[AV]camera`: camera control is a permission a script holds for one avatar. To save a camera for sitter N from the adjuster, copy N must be present.
- Copy N also reads CAMERA lines from a per-sitter `LSpos sitter N` notecard when one exists.
- **Camera by menu button** (see also the Q&A link above): add `BUTTON <label>|90230|<camera_name>`, where `<camera_name>` is the &lt;trigger_name&gt; of a CAMERA line. 90230 returns the menu, 90231 does not; `RESET` as the camera name goes back to the camera of the current pose. See [90230 in the link message reference](../../LuaSitter2/LINK_MESSAGES.md#90230).

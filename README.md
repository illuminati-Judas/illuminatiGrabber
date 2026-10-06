# illuminati Grabber 1.1

Chrome extension สำหรับเลือกดาวน์โหลดรูปและวิดีโอจากหน้าเว็บ รวมถึงสื่อปัจจุบันบน X และ Telegram Web ใช้เฉพาะเนื้อหาที่คุณมีสิทธิ์ดาวน์โหลด

## Installation / วิธีติดตั้ง — Windows และ macOS (OS X)

| ระบบที่คุณใช้ | คู่มือติดตั้งทีละขั้น | ไฟล์ที่ต้องดาวน์โหลด |
|---|---|---|
| Windows 10/11 x64 | [ติดตั้ง Windows](#install-windows) | [Windows installer ZIP](https://github.com/illuminati-Judas/illuminatiGrabber/releases/download/v1.1.0-windows.1/illuminatiGrabber-windows-x64.zip) |
| Mac / macOS (เดิมชื่อ OS X) | [ติดตั้ง macOS](#install-macos) | [Source ZIP พร้อม macOS installer](https://github.com/illuminati-Judas/illuminatiGrabber/archive/refs/heads/main.zip) — ยังไม่รวม dependencies |

**เลือกทำเฉพาะหัวข้อของเครื่องคุณ ไม่ต้องใช้ Git, Node.js, `npm test` หรือคำสั่งตรวจสอบโครงการด้านล่าง** โปรแกรมยังไม่ได้ติดตั้งผ่าน Chrome Web Store จึงต้องเพิ่ม extension ด้วยตนเองหนึ่งครั้ง

<a id="install-windows"></a>

### ติดตั้ง Windows 10/11 แบบ x64

1. [ดาวน์โหลดชุดติดตั้ง Windows ZIP](https://github.com/illuminati-Judas/illuminatiGrabber/releases/download/v1.1.0-windows.1/illuminatiGrabber-windows-x64.zip) จาก repository นี้ ไม่ใช่ปุ่ม **Code → Download ZIP** ซึ่งเป็น source สำหรับนักพัฒนา
2. คลิกขวาไฟล์ ZIP → **Extract All / แยกทั้งหมด** แล้วเปิดโฟลเดอร์ที่แตกแล้ว ห้ามเปิดตัวติดตั้งจากด้านใน ZIP
3. เปิดโฟลเดอร์ `installer` → `windows` แล้วดับเบิลคลิก **`install.cmd`** ใช้บัญชีปกติ ไม่ต้อง Run as administrator และไม่ต้องลง Python, yt-dlp หรือ ffmpeg เอง
4. รอให้ติดตั้งและตรวจสอบสำเร็จ ถ้าขึ้น error ให้หยุดและเก็บข้อความ error ไว้ ไม่ถือว่าติดตั้งเสร็จ
5. เปิด Google Chrome พิมพ์ `chrome://extensions` ในช่องที่อยู่ แล้วกด Enter
6. เปิด **Developer mode / โหมดนักพัฒนาซอฟต์แวร์** ที่มุมขวาบน แล้วคลิก **Load unpacked / โหลดส่วนขยายที่คลายการแพคแล้ว**
7. ในหน้าต่างเลือกโฟลเดอร์ วาง `%LOCALAPPDATA%\WebMediaGrabber\extension` ในช่องที่อยู่ กด Enter แล้วเลือกโฟลเดอร์นี้ — ไม่ใช่โฟลเดอร์ ZIP ที่ดาวน์โหลด
8. ตรวจว่ามีการ์ด **illuminati Grabber** และเปิดใช้งานอยู่ จากนั้นกดไอคอนรูปจิ๊กซอว์ใน Chrome แล้วปักหมุด extension เพื่อเรียกใช้ง่าย

`%LOCALAPPDATA%` เป็นตัวแทนโฟลเดอร์ของบัญชี Windows คุณ วางตามนี้ได้เลย ไม่ต้องแทนด้วยชื่อของใคร ชุดนี้รองรับ x64 ไม่ใช่ Windows ARM64

**ข้อควรทราบ:** EXE ยังไม่มีลายเซ็นดิจิทัล Windows อาจแสดงคำเตือน อย่าปิดระบบป้องกันหรือข้ามนโยบายบริษัท หากถูกบล็อกให้ตรวจแหล่งดาวน์โหลดและปรึกษา IT ก่อน รายละเอียด: [คู่มือ Windows](installer/windows/WINDOWS.md)

<a id="install-macos"></a>

### ติดตั้ง Mac / macOS (OS X)

**macOS ยังไม่ใช่ชุดติดตั้งแบบมี dependency ครบในไฟล์เดียว:** ต้องมี Google Chrome, `/usr/bin/python3`, yt-dlp และ ffmpeg ตัวติดตั้งจะพยายามติดตั้งสองตัวหลังผ่าน Homebrew ที่ `/opt/homebrew/bin/brew` หากยังไม่มี หากขึ้นว่า dependency หรือ Python ไม่พร้อม ให้หยุดและแก้ตาม error ก่อน ไม่ต้องรันคำสั่งทดสอบของนักพัฒนา

1. ที่หน้า repository เลือก **Code → Download ZIP** แล้วดับเบิลคลิก ZIP เพื่อแตกไฟล์
2. เปิดโฟลเดอร์ที่แตกแล้ว → `installer` → ดับเบิลคลิก **`install.command`** หน้าต่าง Terminal จะเปิดระหว่างติดตั้ง รอจนขึ้น **Installed and verified.** ถ้าขึ้น error แสดงว่ายังไม่เสร็จ
3. เปิด Google Chrome → พิมพ์ `chrome://extensions` → เปิด **Developer mode** → คลิก **Load unpacked**
4. ในหน้าต่างเลือกโฟลเดอร์ กด **Command + Shift + G** แล้ววาง `~/Library/Application Support/WebMediaGrabber/extension` กด Enter และเลือกโฟลเดอร์นี้
5. ตรวจว่ามีการ์ด **illuminati Grabber** เปิดใช้งานอยู่ แล้วปักหมุดผ่านไอคอนจิ๊กซอว์ใน Chrome

`~` หมายถึง home folder ของคุณเอง ใช้ข้อความนี้ได้เลย ไม่ต้องใส่ชื่อบัญชีของผู้พัฒนา หาก macOS ไม่อนุญาตให้เปิดไฟล์ อย่าปิด Gatekeeper ทั้งระบบ ให้ตรวจแหล่งไฟล์และข้อความเตือนก่อน รายละเอียด: [คู่มือ macOS](installer/README.md)

### ทดลองใช้หลังติดตั้ง

1. เปิดหน้าเว็บที่มีรูปหรือวิดีโอ แล้วคลิกไอคอน **illuminati Grabber**
2. เลือกรายการ แล้วกด **Download selected** สำหรับเว็บทั่วไป ส่วน Telegram ให้เปิดรูป/วิดีโอใน Media Viewer ก่อนใช้ **Download Photo / Download Video**
3. ตรวจไฟล์ผ่านหน้า Downloads ของ Chrome (`chrome://downloads`) โดยทั่วไปอยู่ใต้โฟลเดอร์ `Downloads/WebMedia` หรือปลายทางที่คุณเลือก
4. หากมี error **Native host / Helper not found** แปลว่า Chrome ติดต่อส่วนช่วยดาวน์โหลดไม่ได้ ตรวจว่าตัวติดตั้งสำเร็จและเลือกโฟลเดอร์ extension ที่ติดตั้งแล้วจริง ไม่ใช่ source ZIP

### อัปเดตสำหรับผู้ใช้เดิม

ดาวน์โหลดชุดใหม่ของระบบเดียวกัน แตกไฟล์และรันตัวติดตั้งใหม่ เมื่อสำเร็จให้เปิด `chrome://extensions` แล้วกดปุ่ม **Reload** บนการ์ดเดิม จากนั้นรีเฟรชหน้าเว็บที่เปิดค้างไว้ ไม่ต้องเพิ่ม extension ซ้ำอีกชุด

> คู่มือนี้อธิบายขั้นตอนตามตัวติดตั้ง ไม่ใช่การรับรองว่าได้ทดสอบกับเครื่องผู้ใช้ทุกระบบ Windows CI ของ release ผ่านแล้ว แต่การใช้งานจริงครบวงจรใน Chrome บนเครื่อง Windows ผู้ใช้ยังรอการยืนยัน

---

## รายละเอียด build และข้อมูลสำหรับนักพัฒนา

## Current build: `1.1.0-history-queue-fix-2`

- **Clear finished** clears completed/failed history and queue entries, preserving active downloads and saved files.
- Generic downloads are recorded as **Web media**; completion metadata and legacy byte counts are reconciled with Chrome Downloads.
- Forbidden/expired URLs require **Scan again**, not blind retries of the same URL.
- Verified: 97 Node tests, 8 native-host tests, and MV3/syntax validation.
- Known limitation: generic URL extensions are not full response-content verification; HTML/MP4 validation and server-access failures remain unresolved. No access-control bypass is provided.
- After updating the installed files, reload the extension in the Chrome profile you use. Diagnostics must report the build above; a new popup alone does not guarantee a new service worker.

Older build notes below are historical, not the current verification status.

Chrome Manifest V3 extension สำหรับค้นหาและดาวน์โหลด Media ที่หน้าเว็บเปิดเผย โดยเพิ่มโหมดเฉพาะสำหรับโพสต์ปัจจุบันบน X และ Media/ข้อความปัจจุบันบน Telegram Web

## ความสามารถ

### เว็บทั่วไป

- สแกน `img`, `srcset`, `picture`, lazy-load attributes และ CSS backgrounds
- สแกน `video`, `source`, poster และลิงก์ MP4/WebM โดยตรง
- รองรับหน้า Dynamic หลังผู้ใช้กด Age Gate หรือโหลดเนื้อหาเพิ่ม
- ดาวน์โหลดลง `Downloads/WebMedia/<domain>/images|videos/`
- คิวดาวน์โหลดแสดงสถานะรายไฟล์ โดยทำพร้อมกันสูงสุด 2 ไฟล์; กด **Retry** เมื่อผิดพลาด หรือ **Cancel** สำหรับไฟล์ที่ยังรออยู่
- Full Preview รองรับวิดีโอ MP4/WebM แบบ Direct URL โดยเริ่มปิดเสียง และไม่เล่น Live stream หรือสื่อที่เข้ารหัส
- Loading ใช้วงกลมหมุนด้านหลัง โดยสามเหลี่ยมและดวงตาอยู่นิ่ง และรองรับการตั้งค่าลดภาพเคลื่อนไหว

### Download Progress / รูปซ้ำ / Video Preview (build 15)

Telegram hotfix build `1.1.0-telegram-save-fix-16`: เรียก Save picker ก่อนงานสร้าง thumbnail เพื่อรักษา user activation; ถ้า Chrome ปฏิเสธ picker ด้วย SecurityError/NotAllowedError ให้ใช้การดาวน์โหลด Blob ตามปกติแทน แต่ยังเคารพการกด Cancel; ไม่เข้าใจปุ่ม Disabled หรือเมนูเลือกคุณภาพว่าเป็นการดาวน์โหลดสำเร็จ ทดสอบจำลองเคสเดียวกันพบ build 15 ไม่ผ่าน 2 ข้อ และ hotfix ผ่านทั้ง 3 ข้อ ชุด Node ทั้งหมด 79 ข้อ + Python 6 ข้อผ่าน แต่ยังต้องยืนยันกับสื่อ Telegram จริงที่ผู้ใช้พบปัญหา

- แผง **Files** แสดง Waiting / Downloading / Completed / Failed สำหรับ Download selected และ Smart Download จาก Popup ของ X/Telegram; โหลดพร้อมกันสูงสุด 2 งาน
- ขณะเปิด Popup จะอ่านจำนวนไบต์จริงทุกวินาที เมื่อไม่ทราบขนาดรวมจะแสดงแถบเคลื่อนไหวแทนเปอร์เซ็นต์; Native Helper ยังไม่ส่งความคืบหน้ารายไบต์ จึงใช้แถบแบบนี้ระหว่างดาวน์โหลด/รวมไฟล์
- **Retry** ใช้ได้เฉพาะ Failed และ **Cancel** ใช้ได้เฉพาะ Waiting; Telegram ต้องเปิดสื่อเดิมก่อน Retry และจะปฏิเสธหากเปลี่ยนไปเป็นสื่ออื่น
- หาก Telegram ส่งต่อให้ปุ่ม Download ของเว็บ จะรอสถานะจาก Chrome Downloads; หากยืนยันไม่ได้ภายใน 2 นาทีจะแสดง Failed พร้อมข้อความให้ตรวจไฟล์ก่อน Retry
- รวม URL ภาพซ้ำจาก URL ที่ normalize แล้ว, resize parameters ที่รู้จัก และชุด `srcset` เดียวกัน เลือกภาพจากความละเอียด/descriptor ที่มี และเลือก `name=orig` บน X; เก็บพารามิเตอร์ชื่อไฟล์และลายเซ็นที่ไม่รู้จักไว้ ไม่ทำ content-hash หรือเดาว่า URL คนละแห่งเป็นไฟล์เดียวกัน
- แจ้งจำนวนรายการซ้ำที่ตัดออกทั้งเว็บทั่วไปและโพสต์ X
- Video Preview ใช้ poster ที่หน้าเว็บให้มา หากไม่มีจะสร้างภาพจากเฟรมสำหรับ Direct MP4/WebM ที่มองเห็นใน Gallery ครั้งละไม่เกิน 2 รายการ พร้อมระยะเวลาและความละเอียด
- พรีวิวถูกปิดเสียงและยกเลิกเมื่อปิด Popup/นำการ์ดออกจากหน้าจอ; แคชเฟรมอยู่ในหน่วยความจำไม่เกิน 60 รายการ ไม่บันทึกลง Storage
- ไม่สร้างพรีวิวจาก HLS/DASH/blob หรือวิดีโอที่ทราบว่า protected; หากพบ `encrypted` จะหยุดทันทีและไม่ร้องขอ license/key หากเซิร์ฟเวอร์ไม่อนุญาต CORS หรือโหลดเฟรมไม่สำเร็จจะแสดงไอคอนแทน
- โหลดแอนิเมชันจาก `assets/loader.svg` ซึ่งเป็นสำเนาแอนิเมชันวงกลมหมุนหลังสามเหลี่ยมที่เตรียมไว้เดิม จึงไม่ต้องพึ่งไฟล์ภายนอกโฟลเดอร์ Extension

### X.com

- จำกัดขอบเขตที่โพสต์ปัจจุบัน `x.com/<user>/status/<id>`
- รูปภาพใช้คุณภาพ `name=orig`
- วิดีโอใช้ `yt-dlp` เลือก `bestvideo*+bestaudio/best`
- ใช้ `ffmpeg` รวม Video/Audio เป็น MP4
- บันทึกใต้ `~/Downloads/WebMedia/x.com/<post-id>/`

### Telegram Web

- เมื่อเปิดรูปหรือวิดีโอใน Media Viewer จะแสดงปุ่ม **Download Photo** หรือ **Download Video** เฉพาะสื่อที่กำลังเปิดอยู่; ไม่มีปุ่มบนรายการสื่อในหน้าแชต
- Popup ยังคงรองรับ **Download Current Media**; หากยังไม่ได้เปิดสื่อจะแสดง **Open Media First** และไม่เดาไฟล์
- ใช้ปุ่ม Download ของ Telegram หากหน้าเว็บมีปุ่มดังกล่าว; มิฉะนั้นดาวน์โหลด `/stream/` แบบ HTTP Range และประกอบไฟล์ภายใน Browser
- รองรับ Direct URL หรือ `blob:` fallback เฉพาะ Media ปัจจุบัน
- เมื่อดาวน์โหลดสำเร็จหรือล้มเหลว จะขึ้น Badge ที่ไอคอน Extension และบันทึกผลใน **Recent Downloads** ของ Popup (ชนิดสื่อ ชื่อไฟล์ ขนาด สถานะ และเวลา)
- รายการใหม่มี Thumbnail แบบ Local-only; กด Thumbnail เพื่อขยาย Preview และกด **Open** เพื่อเปิดไฟล์จริงผ่าน Chrome Downloads
- Gallery แสดงภาพทั้งเฟรมแบบ `contain`; กด **Expand preview** เพื่อใช้พื้นที่ Popup เกือบเต็ม และกด **Exit expanded** หรือ `Esc` เพื่อกลับ
- คลิก Thumbnail เพื่อเปิด Full Preview; ใช้ลูกศรซ้าย/ขวาเลื่อนภาพ, Zoom 50–300%, และดูความละเอียด/ลำดับภาพ โดย checkbox เป็นตัวเลือกดาวน์โหลดแยกต่างหาก
- Expanded Preview มี Sticky Action Bar สำหรับ **Select all visible**, จำนวนที่เลือก, **Download selected** และ **Exit** โดยไม่ต้องออกจาก Gallery
- ปรับ Thumbnail ได้ 3 ระดับ: **Compact / Medium / Large** และจำค่าล่าสุดไว้เฉพาะเครื่องใน `chrome.storage.local`
- Search, Download folder, Resolution filters, Sort และ Thumbnail size อยู่ในแผง **Filters & view** เดียวกัน; พับแผงเพื่อคืนพื้นที่ให้ Gallery
- การ์ดแต่ละรายการแสดง Resolution, ประเภทไฟล์, Domain/source, Estimated file size เมื่อ Resource Timing เปิดเผยข้อมูล และ path **Save as** ที่จะใช้จริงก่อนดาวน์โหลด
- ใต้ชื่อไฟล์จะแสดง Tag `Telegram · ชื่อกรุ๊ป/แชนเนล` เมื่อยืนยันชื่อจาก Header ของกรุ๊ปที่เปิดอยู่ได้; ไม่เก็บข้อความแชตหรือลิงก์ต้นทาง
- ประวัติถูกเก็บเฉพาะใน `chrome.storage.local` สูงสุด 20 รายการ; เปิด Popup เพื่อล้าง Badge หรือกด **Clear** เพื่อลบประวัติ
- ไม่ส่ง Cookie, Token หรือข้อมูลบัญชีออกจากหน้า Telegram และไม่อ่านทั้ง Chat/Channel

## Windows x64 / Chrome

Use the Windows ZIP from [GitHub Releases](https://github.com/illuminati-Judas/illuminatiGrabber/releases/tag/v1.1.0-windows.1): extract the portable ZIP and run
`installer\windows\install.cmd` as your normal user. The delivery bundles the
standalone native host, yt-dlp and ffmpeg; no Python or manual dependency setup
is required on the target. Load `%LOCALAPPDATA%\WebMediaGrabber\extension` through
Chrome **Developer mode → Load unpacked**. Installer details, integrity limits,
uninstall instructions and verification boundaries: [Windows guide](installer/windows/WINDOWS.md).

Windows CI for release `v1.1.0-windows.1` passed. Real Windows Chrome user-machine
validation remains pending. The HTML/MP4 limitation remains unresolved.

## ติดตั้งบน macOS

1. แตก ZIP
2. ดับเบิลคลิก `installer/install.command`
3. Installer จะติดตั้งและตรวจ Local Helper, `yt-dlp` และ `ffmpeg`
4. ใน Chrome เปิด **Developer mode** แล้วกด **Load unpacked**
5. เลือกโฟลเดอร์ที่ Installer เปิดให้:

```text
~/Library/Application Support/WebMediaGrabber/extension
```

Stable Extension ID:

```text
kfdepjgimomjpdcamlkckoagnikohfkm
```

Chrome ไม่อนุญาตให้ Installer ส่วนตัวติดตั้ง Unpacked Extension อัตโนมัติโดยไม่ใช้ Enterprise Policy จึงเหลือขั้นตอน **Load unpacked** ให้ผู้ใช้ยืนยันเองหนึ่งครั้ง โดย Installer จะไม่แก้ Chrome Profile หรือ Policy

## วิธีใช้

1. เปิดเว็บ, โพสต์ X หรือ Telegram Media ที่ต้องการ
2. กดไอคอน Extension; ระบบจะสแกนอัตโนมัติ
3. เว็บทั่วไป: เลือกรายการแล้วกด **Download selected**
4. X: ใช้แถบ **Current post** ใน Popup; Telegram: เปิด Media Viewer แล้วกด **Download Photo** หรือ **Download Video**
5. ถ้าเว็บเพิ่งโหลด Media เพิ่ม ให้กด `↻`

## ความปลอดภัยและข้อจำกัด

- Local-only: ไม่มี Backend, Analytics หรือ Telemetry
- Native Host รับเฉพาะ `ping`, `check_dependencies`, `download_x`, `download_direct`
- X รับเฉพาะ HTTPS status URL ที่ Host ตรวจสอบแล้ว
- Telegram Direct URL จำกัด Telegram media domains และบล็อก localhost/private-network targets
- Subprocess ใช้ Argument Array ไม่มี Shell command interpolation
- Output จำกัดใต้ `~/Downloads/WebMedia`
- ไม่ส่ง Cookie, Token หรือข้อมูลบัญชีให้ Native Host
- ไม่ข้าม Login, Paywall, CAPTCHA, Age Gate หรือ DRM
- Telegram/X DOM อาจเปลี่ยนได้; ถ้าระบุ Media ปัจจุบันไม่ได้ ระบบจะไม่เดาหรือดึงทั้งหน้า
- ใช้ดาวน์โหลดเฉพาะเนื้อหาที่คุณมีสิทธิ์เท่านั้น

## ตรวจสอบโครงการ

### Project path / ตำแหน่งโฟลเดอร์โปรเจกต์

ตัวอย่างคำสั่งใช้ `~/WebMediaGrabber` แทน absolute path ของเครื่องผู้พัฒนา เพื่อไม่เผยแพร่ชื่อบัญชีส่วนตัว และไม่ได้บังคับให้ทุกเครื่องใช้โฟลเดอร์ชื่อนี้

- `~` หมายถึง home directory ของผู้ใช้ที่กำลังรันคำสั่ง ไม่ต้องเปลี่ยนเป็นชื่อผู้พัฒนา
- `WebMediaGrabber` คือชื่อโฟลเดอร์ตัวอย่าง ให้เปลี่ยนเป็นโฟลเดอร์ที่คุณ clone หรือแตก ZIP จริง
- หาก clone ด้วย `git clone https://github.com/illuminati-Judas/illuminatiGrabber.git` จาก home directory โดยไม่กำหนดชื่อปลายทาง ให้ใช้ `cd ~/illuminatiGrabber`
- หากเก็บไว้ที่อื่น ให้ใช้ `cd "/path/to/your/project"` โดยแทน path ตัวอย่างด้วยตำแหน่งจริงของคุณ; ใส่เครื่องหมายคำพูดเมื่อ path มีช่องว่าง
- คำสั่งทดสอบด้านล่างต้องรันจากโฟลเดอร์ source ที่มี `package.json` ไม่ใช่โฟลเดอร์ extension ที่ติดตั้งแล้วหรือชุด Windows portable ที่ไม่มี source/tests ครบ

This is a documentation-only path change. Use your own cloned/extracted source directory; it does not move files, rename the Native Host, or change the installed extension/helper paths. Existing installations do not need to be reinstalled for this README change.

```bash
# Example: source extracted or cloned into this folder
cd ~/WebMediaGrabber
npm test
python3 -m unittest tests/test_native_host.py
npm run check
node tests/e2e-native.js
```

Architecture อยู่ใน `DESIGN.md` และ `DESIGN-X-TELEGRAM.md`

ผลตรวจ build `1.1.0-progress-dedupe-video-15`: Node tests 76 ข้อ, Python tests 6 ข้อ และ `npm run check` ผ่านทั้งหมด ครอบคลุม live byte progress, Retry/Cancel, Native queue, รูปซ้ำ/srcset, X duplicate count, การจับเฟรม/ยกเลิก/CORS/DRM และการปฏิเสธ Telegram Retry เมื่อเปลี่ยนสื่อ การตรวจนี้ใช้ unit/integration fixtures ยังไม่ใช่การยืนยันครบทุกเว็บไซต์จริงใน Chrome

หลังอัปเดตไฟล์ติดตั้ง ให้เปิด `chrome://extensions` แล้วกด Reload ของ **illuminati Grabber** และรีเฟรชหน้า Telegram หากเปิดค้างไว้ ตรวจ build ด้านล่าง Popup ให้เป็น `1.1.0-progress-dedupe-video-15`

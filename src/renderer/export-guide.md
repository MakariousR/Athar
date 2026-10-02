# How to export your chats

To give Athar your history, download a free copy of your chats from ChatGPT, Claude or Gemini, then import one file. Each export takes about 5 minutes of clicking. The company then emails you a download link, usually within minutes, sometimes after a few hours.

The file stays on your computer: Athar reads it there and never uploads it. Do one service at a time, in any order. Menus change from time to time, so a button may have a slightly different name.

## ChatGPT

You import **conversations.json** from the zip file OpenAI emails you.

1. Go to [chatgpt.com](https://chatgpt.com) and sign in.
2. Click your profile picture, then **Settings**.
3. Open **Data controls** and click **Export** next to *Export data*.
4. Click **Confirm export**.
5. Wait for the email from OpenAI, "Your data export is ready". Click **Download data export**. The link works for 24 hours.
6. Right-click the downloaded zip file and choose **Extract All…**
7. In the extracted folder, find **conversations.json**. That is the file to import.

The folder also holds images and a chat.html file; Athar doesn't need them.

## Claude

You import **conversations.json** from the zip file Anthropic emails you.

1. Go to [claude.ai](https://claude.ai) and sign in.
2. Click your name or initials at the bottom left, then **Settings**.
3. Open **Privacy** and click **Export data**.
4. Wait for the email from Anthropic and click its download link. The link expires after about a day.
5. Right-click the downloaded zip file and choose **Extract All…**
6. In the extracted folder, find **conversations.json**. That is the file to import.

If the folder has subfolders such as *conversations-000* and *conversations-001*, each holds its own conversations.json: import each one. Athar also shows the files Claude created or edited in those chats.

## Gemini

You import **MyActivity.json** from Google Takeout. It must be the JSON version: Takeout picks HTML unless you change it (step 6).

1. Go to [takeout.google.com](https://takeout.google.com) and sign in with the Google account you use Gemini with.
2. Click **Deselect all** at the top of the list.
3. Scroll down to **My Activity** and tick it.
4. Click **All activity data included**, then **Deselect all**, tick only **Gemini Apps**, and click **OK**.
5. Click **Multiple formats** under My Activity.
6. Next to *Activity records*, change **HTML** to **JSON**, then click **OK**.
7. Scroll to the bottom and click **Next step**. Keep *Send download link via email*, *Export once* and *.zip*, then click **Create export**.
8. Wait for Google's email and click **Download your files**.
9. Right-click the zip file and choose **Extract All…**
10. Open **Takeout → My Activity → Gemini Apps** and find **MyActivity.json**. That is the file to import.

Gemini saves chats there only while *Gemini Apps Activity* is on in your Google account; chats from times it was off can't be exported.

## Import into Athar

1. Click **Import chat history** at the bottom of the sidebar.
2. Choose the file (conversations.json or MyActivity.json), or drag it onto **Import chat history**.
3. Athar shows how many conversations it added. You can search them in **Memory** right away.

Athar then indexes your chats for search by meaning in the background, newest first. Keep Athar open until it finishes; with a large history this can take a while. Search by meaning needs the local AI engine (Ollama); without it, Athar searches by words.

**Updating later:** export again and import the new file. Athar adds only new and changed conversations, never duplicates. Once a month keeps your memory current.

## If something goes wrong

| Problem | What to do |
| --- | --- |
| No email after a few hours | Check your spam folder. Large histories can take up to a day; if nothing comes, request the export again. |
| The download link has expired | Request a new export; the links work for about a day. |
| Athar says "not a JSON export" | You picked the zip or another file. Extract the zip first, then import conversations.json or MyActivity.json. |
| Athar says it's the HTML version of Gemini activity | In Google Takeout, redo step 6 of the Gemini section: choose JSON, not HTML. |
| No Gemini Apps folder in the Gemini export | Gemini Apps Activity was off, or you exported a different Google account. |
| "No conversations found in this file" | The account has no saved chats, or it's the wrong file in the folder (for example users.json). |
| Imported, but search by meaning is missing | Search by meaning needs Ollama with bge-m3. Without it, Athar searches by words. |

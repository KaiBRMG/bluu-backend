# Context

The goal is to integrate Telegram into the codebase. A telegram bot has been created which will serve both internal employees and creators (clients). Furthermore a Telegram Mini App has been created and linked to the Creator Portal. The intended use is for employees and creators to get automated notifications via the telegram bot, and for creators to access the creator portal. Since creators are to only access the creator portal via telegram, the current sign-in method can be replaced in its entirety with telegram login. 

Telegram bot:
- [t.me/BluuRockBot]
- TELEGRAM_BOT_TOKEN (.env.local)

Telegram Mini App:
- [t.me/BluuRockBot/BluuBackend]

## Requirements 
- Read relevant documentation and do not make assumptions.

- For all items below, ensure the logic holds up and the implementation plan is sound. Ask questions where more certainty is needed.

- Create a unique one-time tokenized telegram link for each user (creator+employee). Creator links can be output here since I will manually send these to them. Users will do it in-app. See Telegram Login in the documentation.

**Creators:**
- When they click start, associate the telegram account with the creator's existing profile; disable the existing email/password sign-in flow; and send the following message via the telegram bot:
"🎉 <b>Welcome <creator name>!</b>

The Creator Portal can now easily be accessed via Telegram! See your custom requests, scheduled calls, and content requirements here 👇 "
- Ensure the creator portal session is now securely linked and can only open via the telegram account accessing it.
- The current creator portal login screen can be safely removed.
- Via the `setChatMenuButton` API, set the creator's telegram manu button to 'Creator Portal' linked to src\app\creator.
- The flow for future creators will be: admin user adds creator in src\app\(main)\admin-portal\creator-management and generates a one-time unique link for admin to copy and send to the creator. Display on src\app\(main)\admin-portal\creator-management if a creator is still to connect Telegram or if it is connected successfully.

**Employees:**
- Create a small-medium sized banner card that is positioned in the upper right corner of the window below the top bar. The card must persist on all pages. Main text: "Bluu Backend has integrated with Telegram". Come up with appropriate sub text that says important updates can now be shared directly. 
- Add buttons at the bottom: Link Account (main), Remind me later. Remind me later must trigger continuously on the next app start or clock-out event. When the click link account, the unique link must be opened in the user's browser. Add a small 'x' icon in the top right corner, if they click this the card can be dismissed indefinitely.
- When they click Start in Telegram, associate the telegram account to their user ID and send the following message via the telegram bot:
"✅ <b>System Alerts Connected!</b>

Your Telegram account is now linked to your Bluu Backend account.

You will begin receiving real-time system alerts, status updates, and critical notifications in this chat. 

<i>Note: This is an automated channel. Can be disabled in Bluu Backend settings.</i>" 
- In src\app\(main)\applications\settings > App Settings in the notification section, add a field for connecting/disconnecting telegram.
- This card mechanism can be repurposed for major feature updates in future. So build the module such that it is a permanent feature of the codebase and customizable. 
- Gate the card and do not trigger for anyone until I flip the switch later. Add a method to trigger for a specific user also (testing).
- Display an individual's Telegram status (connected or not connected) on src\app\(main)\admin-portal\user-management


# Documentation

- Telegram Mini Apps: [https://core.telegram.org/bots/features#mini-apps]

- Telegram API reference: [https://core.telegram.org/bots/api]

- Telegram Login: [http://core.telegram.org/bots/features#web-login]
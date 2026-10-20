import type { LegalDocument } from "./types";

/**
 * The Privacy Policy (spec §7.18, §11). Every statement matches what the code does; change the
 * product or this text together. Drafted with the privacy-policy skill, checked against Tunisian
 * Organic Law 2004-63 and the GDPR (sources in the M9 Task 11 PR).
 */
export const privacyPolicy: LegalDocument = {
  title: "Privacy Policy",
  updated: "2026-10-20",
  summary: [
    "TapNShow helps groups invite people to meetings and see who's coming. A group decides whom it invites; we keep that data for the group.",
    "We ask Google only to send email from the organizer's own Gmail and to keep the one spreadsheet TapNShow creates. We never read anyone's email.",
    "We don't sell data, show ads or track you across sites. Our analytics use no cookies and never see personal links.",
    "Your data is stored in Frankfurt, Germany, by the services listed below.",
    "You can download your answers and delete your account yourself from Account. Write to us for anything else.",
  ],
  sections: [
    {
      id: "who",
      title: "Who runs TapNShow",
      body: "TapNShow is run by Mohamed Ali Chouikh, an individual in Tunisia. TapNShow is made for groups in Tunisia that meet regularly, such as student clubs, associations and volunteer teams. Tunisian law on personal data (Organic Law No. 2004-63) applies, and we give everyone the rights described below.",
    },
    {
      id: "groups",
      title: "Groups decide whom they invite",
      body: "A group's organizers create a workspace, add the people they want to invite and send meetings from their own Gmail. The group decides whom it adds and why; TapNShow stores and processes that data for the group. If a group invited you and you have a question about why, ask the group first. You can always stop a group's emails with the link at the bottom of any invite, or tell us with \"Not my group\" if you don't know the group.",
    },
    {
      id: "data",
      title: "What we keep",
      body: [
        "- **Your account:** your email address, the name you choose, your profile picture address if you sign in with Google, and the last workspace you opened.",
        "- **Workspaces:** the group's name, its settings and meeting defaults, and who is on its team (Owner, Admins, Viewers).",
        "- **People a group invites:** their name, email address, the group's lists they're on, and whether they asked for no more emails.",
        "- **Meetings and answers:** the meeting details, who was invited, each answer (going, late, not going), an optional reason and comment, and who was checked in at the door.",
        "- **Gmail and Google Sheets connections:** the Google account's email, the permissions it granted, and a sign-in key Google gives us, stored encrypted.",
        "- **Reminders on your phone or computer:** if you turn them on, the address your browser gives us for notifications.",
        "- **Security and error records:** short-lived counters per IP address to stop abuse, and error reports with personal links and secrets removed.",
      ].join("\n"),
    },
    {
      id: "google",
      title: "Google data",
      body: [
        "TapNShow asks Google for two permissions, only when an organizer chooses to connect:",
        "",
        "- **Send email on your behalf (gmail.send):** to send the group's meeting emails (invites, calendar invites, updates, cancellations and reminders) from the organizer's own Gmail. TapNShow cannot read, search or delete any email.",
        "- **Files TapNShow creates (drive.file):** to create and update the one Google Sheet that follows a workspace's answers. Besides writing that file, TapNShow only checks whether it's in the trash and reads its own tabs. It cannot see any other file.",
        "",
        "Signing in with Google gives us your name, email address and profile picture address. We use Google data only to provide these features and never for ads. Who can see it is in the next section.",
        "",
        "TapNShow does not use Google Workspace APIs (Gmail, Google Drive, Google Sheets), or any data received from them, to develop, improve or train AI or ML models, personalized or not.",
        "",
        "TapNShow's use and transfer to any other app of information received from Google APIs will adhere to [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.",
      ].join("\n"),
    },
    {
      id: "google-sharing",
      title: "Who we share Google data with",
      body: [
        "We don't sell, rent or trade Google data, and we don't transfer or disclose it to anyone else, except:",
        "",
        "- **People in your groups:** everyone on a workspace's team (Owner, Admins, Viewers) sees the team's names and email addresses, the Google addresses that send the group's emails and hold its Google Sheet, and who connected them. People a group invites see its Gmail address as the sender of its emails.",
        "- **Our team:** TapNShow's admins see each workspace Owner's name and email address, to run TapNShow and look into reports of abuse.",
        "- **The services that run TapNShow:** Supabase stores it and Vercel runs the app that uses it, both in Frankfurt, Germany; Sentry receives error reports, with personal links, secrets and IP addresses removed. They process it only for TapNShow, under their own terms (see [Services we use](#services)).",
        "- **Google:** the group's emails go out through the connected Gmail, and its answers go into the Google Sheet in the connected account's Drive.",
        "- **When the law requires it:** if Tunisian law or a court orders us to, or to protect people from abuse of TapNShow.",
        "- **A new owner:** if TapNShow is ever passed to another person or company, we will ask for your consent before your Google data goes with it.",
      ].join("\n"),
    },
    {
      id: "use",
      title: "How we use data",
      body: "We use data only to run TapNShow: to sign you in, send a group's emails and notifications, show answers to the group's organizers, keep the group's Google Sheet up to date, stop abuse, and fix problems. We don't sell or rent data, we don't show ads, and we don't use it to build profiles of you.",
    },
    {
      id: "visibility",
      title: "Who sees what",
      body: [
        "- Everyone on a workspace's team, Viewers included, sees the team's email addresses and every invited person's name and email address.",
        "- Only a group's organizers see answers, reasons and comments. People invited never see each other's answers.",
        "- A group's Google Sheet is visible to everyone the organizer shares it with in Google Drive. Organizers are told this before they turn it on.",
        "- Your answer page shows only your own invite.",
      ].join("\n"),
    },
    {
      id: "services",
      title: "Services we use and where your data is",
      body: [
        "These services process data for TapNShow, each under its own terms:",
        "",
        "- **Supabase:** the database and sign-in, in Frankfurt, Germany.",
        '- **Vercel:** hosting, in Frankfurt, Germany, plus Web Analytics and Speed Insights, which use no cookies and see only page types (such as "an answer page"), never personal links.',
        "- **Sentry:** error reports, stored in the EU, with personal links, secrets and IP addresses removed before they leave.",
        "- **Google:** sending email through Gmail (the organizer's own account, and our account for sign-in codes and team invites), and the Google Sheet.",
        "",
        "Using TapNShow means your data is stored outside Tunisia, with these services.",
      ].join("\n"),
    },
    {
      id: "retention",
      title: "How long we keep data",
      body: [
        "- Your account and your workspaces' data stay until you or the workspace's Owner delete them.",
        "- Gmail and Google Sheets connections: until no workspace uses them any more. We then delete them and ask Google to remove TapNShow's access, unless someone else still uses that Google account in TapNShow.",
        "- Records of sent emails: 30 days.",
        "- Abuse counters (including IP addresses): 2 days.",
        "- Reminder devices you haven't used for 90 days are removed.",
        "- Empty draft meetings: 24 hours.",
        "- Our admin log (for example, when a group's sending was paused): kept for as long as TapNShow runs. It names workspaces, never their members, and shows our team's addresses only partly.",
      ].join("\n"),
    },
    {
      id: "deletion",
      title: "Deleting your data",
      body: [
        "- **Your account:** go to [Account](/account) and choose Delete my account. We erase your reasons and comments in every group, remove you from every workspace, disconnect your Google connections and delete your account. Your answers' statuses and check-ins stay with the groups for their records. If you own a workspace, give it to an Admin or delete it first.",
        "- **A workspace:** its Owner can delete it from Settings; all its data is deleted. Our admin log keeps the workspace's name next to anything our team did about it.",
        "- **Copies:** we can't reach copies people made themselves, such as a downloaded file or a copy of a group's Google Sheet.",
      ].join("\n"),
    },
    {
      id: "device",
      title: "On your device",
      body: "TapNShow uses one sign-in cookie to keep you signed in, and two short-lived cookies while you connect Google. It saves a few small settings on your device (your theme, a list filter, and when you last checked reminders). If you install TapNShow, it keeps a copy of your own invites so you can read them offline; that copy is wiped when you sign out, when someone else signs in on the device, and when you delete your account. We use no advertising or tracking cookies.",
    },
    {
      id: "security",
      title: "Security",
      body: "Data travels encrypted (HTTPS). Every database table is protected so people see only their own groups' data. Google sign-in keys are stored encrypted. Personal links are random, long and stored only in scrambled form. No system is perfectly safe; if something happens that puts your data at risk, we'll tell the people affected.",
    },
    {
      id: "rights",
      title: "Your rights",
      body: [
        "You can ask to see, correct or delete your data, to get a copy of it, or object to how it's used:",
        "",
        "- Change your name in [Account](/account).",
        "- Download your answers from [Account](/account).",
        "- Delete your account yourself, as described above.",
        "- Stop a group's emails with the link at the bottom of its invites.",
        "",
        "For anything else, write to us (Contact below). We answer within 30 days. You can also complain to Tunisia's data protection authority, the INPDP (Instance Nationale de Protection des Données à caractère Personnel).",
      ].join("\n"),
    },
    {
      id: "age",
      title: "Age",
      body: "TapNShow accounts are for people aged 16 or older.",
    },
    {
      id: "changes",
      title: "Changes to this policy",
      body: "If we change this policy, we update the date at the top. If a change affects how we use your data, we tell signed-in people in TapNShow before it applies.",
    },
    {
      id: "contact",
      title: "Contact",
      body: "Questions or requests about your data: use the Contact link at the bottom of this page. It opens an email to TapNShow.",
    },
  ],
};

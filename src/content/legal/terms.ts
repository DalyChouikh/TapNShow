import type { LegalDocument } from "./types";

/**
 * The Terms of Service (spec §7.18). Drafted with the terms-of-service-generator skill, kept to
 * what applies to a free service aimed at groups in Tunisia under Tunisian law (no payment,
 * arbitration or US-state sections).
 */
export const terms: LegalDocument = {
  title: "Terms of Service",
  updated: "2026-10-15",
  summary: [
    "TapNShow is free. You can use it if you're 16 or older.",
    "Only invite people who belong to your group or asked to join it. Groups that email strangers get their sending paused.",
    "Invites go out from your own Gmail, so Gmail's own rules and limits apply too.",
    "TapNShow is provided as is. Features and limits can change, and we'll do our best to keep it running.",
    "You can delete your account or disconnect Google at any time.",
  ],
  sections: [
    {
      id: "agreement",
      title: "Agreeing to these terms",
      body: "These terms are an agreement between you and Mohamed Ali Chouikh, who runs TapNShow. By creating an account or using TapNShow, you agree to them and to the [Privacy Policy](/privacy). If you don't agree, please don't use TapNShow. If you use it for a group, you confirm you're allowed to act for that group.",
    },
    {
      id: "service",
      title: "What TapNShow does",
      body: "TapNShow lets groups that meet regularly, such as student clubs, associations and volunteer teams in Tunisia, invite people to meetings from the organizer's own Gmail, collect answers, see who's coming, check people in and keep a Google Sheet up to date. TapNShow is free. We don't promise it will stay free forever, and we'll tell you before that changes.",
    },
    {
      id: "age",
      title: "Age",
      body: "You must be 16 or older to create a TapNShow account.",
    },
    {
      id: "account",
      title: "Your account",
      body: "You sign in with a code we email you or with Google. Keep access to that email account safe: anyone who can read it can sign in as you. You're responsible for what happens in your account. Tell us if you think someone else is using it.",
    },
    {
      id: "groups",
      title: "Running a group",
      body: [
        "If you add people to a workspace or send them meetings:",
        "",
        "- Only add people who belong to your group or asked to hear from it, and make sure you're allowed to use their name and email address for that.",
        "- Use TapNShow for your group's meetings, not for advertising or anything unrelated.",
        "- You're responsible for what your group sends. Invites go out from your Gmail, so Google's rules and sending limits apply as well.",
        "- Respect people who say no: when someone asks for no more emails, TapNShow stops sending them your group's invites.",
      ].join("\n"),
    },
    {
      id: "not-allowed",
      title: "What's not allowed",
      body: [
        "- Emailing people who never joined or asked to join your group, or any other spam.",
        "- Harassing, threatening or deceiving anyone.",
        "- Sending anything unlawful, or anything that infringes someone else's rights.",
        "- Trying to get around TapNShow's limits, break its security, or reach data that isn't yours.",
        "- Overloading TapNShow on purpose, or copying it with automated tools.",
      ].join("\n"),
    },
    {
      id: "reports",
      title: "Reports and paused sending",
      body: "Every invite has a \"Not my group\" link. If enough people a workspace emails report it in a short time, TapNShow pauses that workspace's sending automatically, and the Owner is told. TapNShow's administrators can also pause or resume a workspace's sending. While sending is paused, the workspace keeps all its data and can still be used, but no emails go out. We may suspend an account that breaks these terms.",
    },
    {
      id: "google",
      title: "Gmail and Google Sheets",
      body: "Connecting Gmail or Google Sheets is optional. You can disconnect them in Settings, or remove TapNShow's access in your Google Account, at any time. How TapNShow uses Google data is explained in the [Privacy Policy](/privacy#google).",
    },
    {
      id: "content",
      title: "Your content",
      body: "Your group's meetings, lists and answers stay yours. You allow TapNShow to store, show and send them only to run the service for you, as the Privacy Policy describes. TapNShow's name, design and code belong to its maker.",
    },
    {
      id: "changes",
      title: "Changes to TapNShow and these terms",
      body: "We can change, add or remove features and limits (for example how many emails a workspace can send a day). We'll update these terms when needed and change the date at the top. If a change matters for how you use TapNShow, we'll say so in TapNShow before it applies. Using TapNShow after that means you accept the new terms.",
    },
    {
      id: "as-is",
      title: "No guarantees",
      body: 'TapNShow is provided "as is" and "as available". We do our best to keep it running and your data safe, but we can\'t promise it will always work, be free of errors, or that an email will always arrive. As far as the law allows, we\'re not responsible for indirect losses, such as a missed meeting, that come from using or not being able to use TapNShow. Nothing in these terms limits rights you have under Tunisian law that can\'t be limited.',
    },
    {
      id: "ending",
      title: "Ending",
      body: "You can stop using TapNShow at any time and delete your account from [Account](/account). We can suspend or close an account or a workspace that breaks these terms, and we'll explain why when we can. If we ever close TapNShow, we'll give notice so groups can download their data first.",
    },
    {
      id: "law",
      title: "Law and disputes",
      body: "These terms are governed by Tunisian law. If something goes wrong, please write to us first so we can try to fix it. If we can't agree, the competent courts of Tunisia decide.",
    },
    {
      id: "contact",
      title: "Contact",
      body: "Questions about these terms: use the Contact link at the bottom of this page. It opens an email to TapNShow.",
    },
  ],
};

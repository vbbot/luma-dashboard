import { convexUrl } from "../config";
import { MenuLink, Screen } from "../ui";

export function HomeScreen() {
  return (
    <Screen title="Luma" centered>
      <nav className="menu">
        <MenuLink to="/tools">Tools</MenuLink>
        <MenuLink to="/lockscreen">Lock Screen</MenuLink>
        <MenuLink to="/account">Account</MenuLink>
        <MenuLink to="/help">Help</MenuLink>
      </nav>
    </Screen>
  );
}

export function HelpScreen({ backTo }: { backTo: string }) {
  return (
    <Screen title="Help" backTo={backTo}>
      <article className="prose">
        <h2>Connecting your phone</h2>
        <ol>
          <li>Create an account here and copy the 16-digit account number.</li>
          <li>
            In Luma on your Light Phone, open the login screen, tap <strong>Server</strong>, and
            enter <code>{convexUrl}</code>.
          </li>
          <li>Enter your account number and confirm.</li>
        </ol>
        <h2>Tools</h2>
        <p>
          Tools added here appear on your phone's home screen within a few seconds. Reorder and
          rename them on the phone itself.
        </p>
        <ul>
          <li>
            <strong>Light</strong>: the built-in LightOS tools. Phone and Settings are always on.
          </li>
          <li>
            <strong>No Scrolling</strong>: apps Luma downloads and installs from GitHub.
          </li>
          <li>
            <strong>Android</strong>: other apps already installed on your phone. The list fills in
            once Luma has synced with this server.
          </li>
        </ul>
        <h2>Lock Screen</h2>
        <p>
          Show a short message above the clock, for example if the phone is lost, and up to two
          lines from integrations below it: the weather for a place, your Habitica tasks (step through
          them with the arrows and long-press to complete one), or a webhook that anything (Home
          Assistant, an iOS Shortcut, a script) can send text to. Needs Luma 2.0.23 or later
          for the integrations.
        </p>
      </article>
    </Screen>
  );
}

export function PrivacyScreen({ backTo }: { backTo: string }) {
  return (
    <Screen title="Privacy Policy" backTo={backTo}>
      <article className="prose">
        <p>
          This dashboard is self-hosted. Everything it stores stays on the server it runs on and
          is never shared with anyone else, except as described for weather below.
        </p>
        <p>For each account the server stores:</p>
        <ul>
          <li>The account number.</li>
          <li>The tools and apps you have added.</li>
          <li>
            For each connected phone: a random installation ID, when it last synced, and the names
            of launchable apps installed on it.
          </li>
          <li>Any lock screen message you send, until you replace or remove it.</li>
          <li>
            Your lock screen integrations: the place you chose for weather, webhook addresses, your
            Habitica User ID and API Token (encrypted), and what each one currently shows.
          </li>
        </ul>
        <p>
          For weather, the server sends the place names you search for, and the place you choose
          rounded to about a kilometre, to{" "}
          <a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">
            Open-Meteo
          </a>
          . Nothing identifying your account is sent with them.
        </p>
        <p>Deleting your account removes all of this immediately.</p>
      </article>
    </Screen>
  );
}

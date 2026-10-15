import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Category } from "./items";
import { navigate, useRoute } from "./router";
import { useSession } from "./session";
import { Loading, Screen } from "./ui";
import { LoginScreen } from "./screens/LoginScreen";
import { CreateAccountScreen } from "./screens/CreateAccountScreen";
import { HelpScreen, HomeScreen, PrivacyScreen } from "./screens/InfoScreens";
import { AddCategoryScreen, AddToolsScreen, ToolsScreen } from "./screens/ToolsScreens";
import { AccountScreen } from "./screens/AccountScreen";
import { MessageScreen } from "./screens/MessageScreen";

const CATEGORIES: Category[] = ["light", "noscroll", "android"];

export function App() {
  const route = useRoute();
  const { accountNumber, logIn, logOut } = useSession();

  return (
    <>
      {route === "/help" ? (
        <HelpScreen backTo="/" />
      ) : route === "/privacy" ? (
        <PrivacyScreen backTo={accountNumber === null ? "/" : "/account"} />
      ) : accountNumber === null ? (
        route === "/create" ? (
          <CreateAccountScreen onLogIn={logIn} />
        ) : (
          <LoginScreen
            onLogIn={(value) => {
              logIn(value);
              navigate("/");
            }}
          />
        )
      ) : (
        <SignedIn route={route} accountNumber={accountNumber} onLogOut={logOut} />
      )}
      <footer className="footer">
        Self-hosted Luma dashboard. Luma is made by{" "}
        <a href="https://github.com/sponsors/vandamd" target="_blank" rel="noreferrer">
          vandamd
        </a>
        , please consider supporting them.
      </footer>
    </>
  );
}

function SignedIn({
  route,
  accountNumber,
  onLogOut,
}: {
  route: string;
  accountNumber: string;
  onLogOut: () => void;
}) {
  const dashboard = useQuery(api.accounts.getDashboard, { accountNumber });

  // The account was deleted, possibly from another browser.
  useEffect(() => {
    if (dashboard === null) {
      onLogOut();
    }
  }, [dashboard, onLogOut]);

  const logOut = () => {
    onLogOut();
    navigate("/");
  };

  if (route === "/account") {
    return <AccountScreen accountNumber={accountNumber} onLogOut={logOut} />;
  }
  if (route === "/message") {
    return <MessageScreen accountNumber={accountNumber} />;
  }
  if (!route.startsWith("/tools")) {
    return <HomeScreen />;
  }

  if (dashboard == null) {
    return (
      <Screen title="Tools" backTo="/" centered>
        <Loading />
      </Screen>
    );
  }

  if (route === "/tools/add") {
    return <AddToolsScreen />;
  }
  const category = CATEGORIES.find((value) => route === `/tools/add/${value}`);
  if (category !== undefined) {
    return <AddCategoryScreen accountNumber={accountNumber} dashboard={dashboard} category={category} />;
  }
  return <ToolsScreen accountNumber={accountNumber} dashboard={dashboard} />;
}

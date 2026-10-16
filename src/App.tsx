import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { ListCategory } from "./items";
import { navigate, useRoute } from "./router";
import { useSession } from "./session";
import { Loading, Screen } from "./ui";
import { LoginScreen } from "./screens/LoginScreen";
import { CreateAccountScreen } from "./screens/CreateAccountScreen";
import { HelpScreen, HomeScreen, PrivacyScreen } from "./screens/InfoScreens";
import { AddCategoryScreen, AddToolsScreen, ToolsScreen } from "./screens/ToolsScreens";
import { AccountScreen } from "./screens/AccountScreen";
import { MessageScreen } from "./screens/MessageScreen";
import { StoreAppScreen, StoreCategoriesScreen, StoreCategoryScreen, storeCategoryPath } from "./screens/StoreScreens";

const CATEGORIES: ListCategory[] = ["light", "android"];

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
  const store = useQuery(api.appStore.list);

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
  if (!route.startsWith("/tools") && !route.startsWith("/store")) {
    return <HomeScreen />;
  }

  if (dashboard == null) {
    return (
      <Screen title="Tools" backTo="/" centered>
        <Loading />
      </Screen>
    );
  }

  if (route === "/store") {
    return <StoreCategoriesScreen store={store} />;
  }
  const storeCategory = /^\/store\/c\/(.+)$/.exec(route)?.[1];
  if (storeCategory !== undefined) {
    return (
      <StoreCategoryScreen store={store} dashboard={dashboard} category={decodeURIComponent(storeCategory)} />
    );
  }
  const storeAppId = /^\/store\/app\/(.+)$/.exec(route)?.[1];
  if (storeAppId !== undefined) {
    const appId = decodeURIComponent(storeAppId);
    const category = store?.apps.find((app) => app.appId === appId)?.category;
    return (
      <StoreAppScreen
        store={store}
        dashboard={dashboard}
        accountNumber={accountNumber}
        appId={appId}
        backTo={category ? storeCategoryPath(category) : "/store"}
      />
    );
  }

  if (route === "/tools/add") {
    return <AddToolsScreen />;
  }
  const category = CATEGORIES.find((value) => route === `/tools/add/${value}`);
  if (category !== undefined) {
    return <AddCategoryScreen accountNumber={accountNumber} dashboard={dashboard} category={category} />;
  }
  return <ToolsScreen accountNumber={accountNumber} dashboard={dashboard} store={store} />;
}

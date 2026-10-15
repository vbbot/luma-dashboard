import { useState } from "react";
import {
  availableItems,
  CATEGORY_LABELS,
  enabledItems,
  type Category,
  type Dashboard,
  type HomeItem,
} from "../items";
import { useHomeItemActions } from "../useHomeItems";
import { navigate } from "../router";
import { ItemRow, MenuLink, MinusCircleIcon, PlusCircleIcon, Screen } from "../ui";

type Props = { accountNumber: string; dashboard: Dashboard };

function usePendingAction(action: (item: HomeItem) => Promise<unknown>) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(item: HomeItem) {
    setPendingKey(item.key);
    setError(null);
    try {
      await action(item);
    } catch {
      setError(`Unable to update ${item.label}.`);
    } finally {
      setPendingKey(null);
    }
  }

  return { pendingKey, error, run };
}

export function ToolsScreen({ accountNumber, dashboard }: Props) {
  const { remove } = useHomeItemActions(accountNumber, dashboard);
  const { pendingKey, error, run } = usePendingAction(remove);

  return (
    <Screen
      title="Tools"
      backTo="/"
      action={{ label: "Add tools", icon: <PlusCircleIcon />, to: "/tools/add" }}
    >
      {error !== null && <p className="error">{error}</p>}
      <div className="item-list">
        {enabledItems(dashboard).map((item) => (
          <ItemRow
            key={item.key}
            label={item.label}
            disabled={item.fixed || pendingKey === item.key}
            icon={item.fixed ? undefined : <MinusCircleIcon />}
            iconLabel="Remove"
            onClick={item.fixed ? undefined : () => run(item)}
          />
        ))}
      </div>
    </Screen>
  );
}

export function AddToolsScreen() {
  return (
    <Screen title="Add Tools" backTo="/tools" centered>
      <nav className="menu">
        {(Object.keys(CATEGORY_LABELS) as Category[]).map((category) => (
          <MenuLink key={category} to={`/tools/add/${category}`}>
            {CATEGORY_LABELS[category]}
          </MenuLink>
        ))}
      </nav>
    </Screen>
  );
}

const EMPTY_MESSAGES: Record<Category, string> = {
  light: "All Light tools are already added.",
  noscroll: "All No Scrolling apps are already added.",
  android:
    "No more apps to add. Apps installed on your phone appear here after Luma syncs with this server.",
};

export function AddCategoryScreen({ accountNumber, dashboard, category }: Props & { category: Category }) {
  const { add } = useHomeItemActions(accountNumber, dashboard);
  const { pendingKey, error, run } = usePendingAction(async (item) => {
    await add(item);
    navigate("/tools");
  });
  const items = availableItems(dashboard, category);

  return (
    <Screen title={CATEGORY_LABELS[category]} backTo="/tools/add">
      {error !== null && <p className="error">{error}</p>}
      {items.length === 0 ? (
        <p className="muted centered-text">{EMPTY_MESSAGES[category]}</p>
      ) : (
        <div className="item-list">
          {items.map((item) => (
            <ItemRow
              key={item.key}
              label={item.label}
              disabled={pendingKey === item.key}
              icon={<PlusCircleIcon />}
              iconLabel="Add"
              onClick={() => run(item)}
            />
          ))}
        </div>
      )}
    </Screen>
  );
}

import React, { createContext, useContext, useMemo } from 'react';

type MessageArgs = Record<string, string | number | undefined>;
type Messages = Record<string, string>;

interface L10nContextValue {
  locale: string;
  t: (key: string, args?: MessageArgs) => string;
}

const L10nContext = createContext<L10nContextValue>({
  locale: 'en',
  t: (key) => key,
});

function formatMessage(
  template: string,
  args?: MessageArgs
): string {
  if (!args) {
    return template;
  }

  let message = template;
  for (const [argKey, value] of Object.entries(args)) {
    if (value === undefined) {
      continue;
    }
    message = message.replace(
      new RegExp(`\\{${argKey}\\}`, 'g'),
      String(value)
    );
  }
  return message;
}

interface L10nProviderProps {
  locale: string;
  messages: Messages;
  children: React.ReactNode;
}

export const L10nProvider: React.FC<L10nProviderProps> = ({
  locale,
  messages,
  children,
}) => {
  const value = useMemo<L10nContextValue>(
    () => ({
      locale,
      t: (key, args) =>
        formatMessage(messages[key] ?? key, args),
    }),
    [locale, messages]
  );

  return (
    <L10nContext.Provider value={value}>{children}</L10nContext.Provider>
  );
};

export function useL10n(): L10nContextValue {
  return useContext(L10nContext);
}

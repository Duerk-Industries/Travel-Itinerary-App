import { screenFetch as fetch } from '../cache/screenFetch';
import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';

type Props = {
  backendUrl: string;
  headers: Record<string, string>;
  expenseId: string;
  title: string;
  testID?: string;
};

/** A small picture of an expense's stored receipt, for the expense detail. Renders nothing until the image is available. */
const ReceiptThumbnail: React.FC<Props> = ({ backendUrl, headers, expenseId, title, testID }) => {
  const _styleTheme = useStyleTheme();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    (async () => {
      try {
        const res = await fetch(`${backendUrl}/api/expenses/${encodeURIComponent(expenseId)}/receipt`, { headers });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data.url) setUrl(String(data.url));
      } catch {
        // The Receipt button still opens the full panel, which reports a problem with the image.
      }
    })();
    return () => { cancelled = true; };
    // headers is rebuilt by the caller on every render; the expense decides when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, expenseId]);

  if (!url) return null;
  return <Image testID={testID} source={{ uri: url }} accessibilityLabel={`Receipt thumbnail for ${title}`} style={themeStyle('components_ReceiptThumbnail_1', {}, _styleTheme)} resizeMode="cover" />;
};

export default ReceiptThumbnail;

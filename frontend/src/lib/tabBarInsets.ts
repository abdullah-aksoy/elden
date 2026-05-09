import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** İkon + etiket satırı (padding hariç). */
const TAB_BAR_ROW = 50;

/** Sistem gezinme çubuğu / home indicator için tab bar alt boşluğu. */
export function tabBarBottomInset(insetBottom: number): number {
  return Math.max(insetBottom, Platform.OS === 'android' ? 12 : 4);
}

/** Tab bar’ın toplam yüksekliği (içerik + alt güvenli alan). */
export function tabBarTotalHeight(insetBottom: number): number {
  const b = tabBarBottomInset(insetBottom);
  return TAB_BAR_ROW + b + 6;
}

/** Liste / ScrollView içeriğinin tab bar arkasında kalmaması için alt padding. */
export function tabContentBottomPadding(insetBottom: number): number {
  return tabBarTotalHeight(insetBottom) + 12;
}

export function useTabContentBottomPadding(): number {
  const { bottom } = useSafeAreaInsets();
  return tabContentBottomPadding(bottom);
}

export function useTabBarStyleProps() {
  const { bottom } = useSafeAreaInsets();
  const padBottom = tabBarBottomInset(bottom);
  return {
    height: TAB_BAR_ROW + padBottom + 6,
    paddingBottom: padBottom,
    paddingTop: 6,
    borderTopWidth: 1 as const,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fff',
  };
}

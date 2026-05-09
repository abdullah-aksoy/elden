/** Metro/Expo derlemesinde process.env doldurulur; @types/node eklemeden tipleme. */
declare const process: {
  env: {
    EXPO_PUBLIC_BACKEND_URL?: string;
    [key: string]: string | undefined;
  };
};

import AsyncStorage from "@react-native-async-storage/async-storage";
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { generateAuthSlice } from "@terreno/rtk";
import { DateTime } from "luxon";
import { useDispatch } from "react-redux";
import type { Storage } from "redux-persist";
import { persistReducer, persistStore } from "redux-persist";

import { appStateReducer } from "./appState";
import { rtkQueryErrorMiddleware } from "./errors";
import { terrenoApi } from "./sdk";

export * from "./appState";
export { useSentryAndToast } from "./errors";

const authSlice = generateAuthSlice(terrenoApi);

export const { logout } = authSlice;

const createSafeStorage = (): Storage => {
  return {
    getItem: async (key: string): Promise<string | null> => {
      if (typeof window !== "undefined") {
        return AsyncStorage.getItem(key);
      }
      return null;
    },
    removeItem: async (key: string): Promise<void> => {
      if (typeof window !== "undefined") {
        return AsyncStorage.removeItem(key);
      }
    },
    setItem: async (key: string, value: string): Promise<void> => {
      if (typeof window !== "undefined") {
        return AsyncStorage.setItem(key, value);
      }
    },
  };
};

const persistConfig = {
  blacklist: ["terreno-rtk"],
  key: "root",
  storage: createSafeStorage(),
  timeout: 0,
  version: 1,
};

const rootReducer = combineReducers({
  appState: appStateReducer,
  auth: authSlice.authReducer,
  "terreno-rtk": terrenoApi.reducer,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

const store = configureStore({
  devTools: process.env.NODE_ENV !== "production" && {
    name: `App-${
      typeof window !== "undefined"
        ? // biome-ignore lint/suspicious/noAssignInExpressions: Window name assignment
          window.name || ((window.name = `Window-${DateTime.now().toFormat("HH:mm:ss")}`))
        : "Unknown"
    }`,
  },
  middleware: (getDefaultMiddleware) => {
    return getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: false,
      thunk: true,
    }).concat([
      ...authSlice.middleware,
      // biome-ignore lint/suspicious/noExplicitAny: RTK Query middleware typing
      terrenoApi.middleware as any,
      rtkQueryErrorMiddleware,
      // biome-ignore lint/suspicious/noExplicitAny: Middleware array typing
    ]) as any;
  },
  reducer: persistedReducer,
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export { useAppSelector } from "./appState";

export { store };
export * from "./sdk";

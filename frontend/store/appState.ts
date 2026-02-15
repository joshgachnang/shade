import {createSlice, type PayloadAction} from "@reduxjs/toolkit";
import type {RootState} from "@terreno/rtk";
import {type TypedUseSelectorHook, useSelector} from "react-redux";

export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export interface AppState {
  darkMode: boolean;
  language: string;
}

const initialState: AppState = {
  darkMode: false,
  language: "en",
};

export const appStateSlice = createSlice({
  initialState,
  name: "appState",
  reducers: {
    resetAppState: () => initialState,
    setDarkMode: (state, action: PayloadAction<boolean>) => {
      state.darkMode = action.payload;
    },
    setLanguage: (state, action: PayloadAction<string>) => {
      state.language = action.payload;
    },
  },
});

export const {setDarkMode, setLanguage, resetAppState} = appStateSlice.actions;

export const useSelectDarkMode = (): boolean => {
  return useAppSelector((state: RootState): boolean => {
    return state.appState.darkMode;
  });
};

export const useSelectLanguage = (): string => {
  return useAppSelector((state: RootState): string => {
    return state.appState.language;
  });
};

export const appStateReducer = appStateSlice.reducer;

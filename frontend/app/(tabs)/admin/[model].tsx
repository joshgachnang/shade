import type {Api} from "@reduxjs/toolkit/query/react";
import {AdminModelTable, AdminScriptList, AdminVersionConfig} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";
import type React from "react";
import {terrenoApi} from "@/store/sdk";

const ADMIN_BASE_URL = "/admin";

const AdminModelScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  const api = terrenoApi as unknown as Api<any, any, any, any>;

  if (model === "__scripts") {
    return <AdminScriptList api={api} baseUrl={ADMIN_BASE_URL} />;
  }

  if (model === "version-config") {
    return <AdminVersionConfig api={api} baseUrl={ADMIN_BASE_URL} />;
  }

  return <AdminModelTable api={api} baseUrl={ADMIN_BASE_URL} modelName={model!} />;
};

// Expo Router requires default export for route files
export default AdminModelScreen;

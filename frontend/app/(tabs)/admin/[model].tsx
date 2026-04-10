import {AdminModelTable} from "@terreno/admin-frontend";
import {baseUrl} from "@terreno/rtk";
import {useLocalSearchParams} from "expo-router";
import type React from "react";
import {terrenoApi} from "@/store/sdk";

const AdminModelScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();

  return <AdminModelTable api={terrenoApi} baseUrl={`${baseUrl}/admin`} modelName={model!} />;
};

// Expo Router requires default export for route files
export default AdminModelScreen;

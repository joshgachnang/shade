import {AdminModelForm} from "@terreno/admin-frontend";
import {baseUrl} from "@terreno/rtk";
import {useLocalSearchParams} from "expo-router";
import type React from "react";
import {terrenoApi} from "@/store/sdk";

const AdminEditScreen: React.FC = () => {
  const {model, id} = useLocalSearchParams<{model: string; id: string}>();

  return (
    <AdminModelForm
      api={terrenoApi}
      baseUrl={`${baseUrl}/admin`}
      itemId={id}
      mode="edit"
      modelName={model!}
    />
  );
};

// Expo Router requires default export for route files
export default AdminEditScreen;

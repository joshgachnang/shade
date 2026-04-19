import type {Api} from "@reduxjs/toolkit/query/react";
import {AdminModelTable} from "@terreno/admin-frontend";
import {Stack, useLocalSearchParams} from "expo-router";
import type React from "react";
import {terrenoApi} from "@/store/sdk";

const AdminModelScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  const title = model ? model.charAt(0).toUpperCase() + model.slice(1) : "Admin";

  return (
    <>
      <Stack.Screen options={{title}} />
      <AdminModelTable
        api={terrenoApi as unknown as Api<any, any, any, any>}
        baseUrl="/admin"
        modelName={model!}
      />
    </>
  );
};

// Expo Router requires default export for route files
export default AdminModelScreen;

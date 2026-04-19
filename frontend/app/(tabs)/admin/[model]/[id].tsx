import type {Api} from "@reduxjs/toolkit/query/react";
import {AdminModelForm} from "@terreno/admin-frontend";
import {Stack, useLocalSearchParams} from "expo-router";
import type React from "react";
import {terrenoApi} from "@/store/sdk";

const AdminEditScreen: React.FC = () => {
  const {model, id} = useLocalSearchParams<{model: string; id: string}>();
  const modelTitle = model ? model.charAt(0).toUpperCase() + model.slice(1) : "Admin";

  return (
    <>
      <Stack.Screen options={{title: `Edit ${modelTitle}`}} />
      <AdminModelForm
        api={terrenoApi as unknown as Api<any, any, any, any>}
        baseUrl="/admin"
        itemId={id}
        mode="edit"
        modelName={model!}
      />
    </>
  );
};

// Expo Router requires default export for route files
export default AdminEditScreen;

"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Creator {
  creatorID: string;
  stageName: string;
}

export default function CACustomRequestsPage() {
  const { user } = useAuth();
  const [creators, setCreators] = useState<Creator[]>([]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    user.getIdToken().then((token) => {
      fetch("/api/disputes/creators", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) setCreators(data.creators ?? []);
        })
        .catch((err) =>
          console.error("[custom-requests] loadCreators failed:", err)
        );
    });

    return () => { cancelled = true; };
  }, [user]);

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Custom Requests
        </h1>

        {creators.length === 0 ? (
          <div className="mt-12">
            <div
              className="rounded-lg p-8 text-center"
              style={{
                background: "var(--sidebar-background)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <p className="text-sm text-muted-foreground">No creators found.</p>
            </div>
          </div>
        ) : (
          <Tabs
            orientation="vertical"
            defaultValue={creators[0].creatorID}
            className="mt-6 flex flex-row gap-4 items-start"
          >
            <TabsList className="flex flex-col h-auto w-48 shrink-0 items-stretch p-1">
              {creators.map((creator) => (
                <TabsTrigger
                  key={creator.creatorID}
                  value={creator.creatorID}
                  className="justify-start"
                >
                  {creator.stageName}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex-1">
              {creators.map((creator) => (
                <TabsContent key={creator.creatorID} value={creator.creatorID}>
                  <div
                    className="rounded-lg p-8 text-center"
                    style={{
                      background: "var(--sidebar-background)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <p className="text-sm text-muted-foreground">
                      No custom requests for {creator.stageName}.
                    </p>
                  </div>
                </TabsContent>
              ))}
            </div>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}

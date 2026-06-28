import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createMessage, getStats, listMessages } from "./api";

const messagesKey = ["messages"] as const;

export function useMessages() {
  return useQuery({
    queryKey: messagesKey,
    queryFn: listMessages,
    refetchInterval: 4000,
  });
}

export function useCreateMessage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createMessage,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: messagesKey });
    },
  });
}

export function useStats() {
  return useQuery({
    queryKey: ["stats"] as const,
    queryFn: getStats,
    refetchInterval: 5000,
  });
}
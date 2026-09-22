kshell() {
  if [ -z "$1" ]; then
    echo "Usage: kshell <partial-pod-name>"
    return 1
  fi

  # Search for pods matching the input and take the first one found
  local POD_NAME=$(kubectl get pods --no-headers -o custom-columns=":metadata.name" | grep "$1" | head -n 1)

  if [ -z "$POD_NAME" ]; then
    echo "❌ No pod found matching: $1"
    return 1
  fi

  if [ $(echo "$POD_NAME" | wc -l) -gt 0 ]; then
     echo "Found pod: $POD_NAME"
     kubectl exec -it "$POD_NAME" -- /bin/bash || kubectl exec -it "$POD_NAME" -- /bin/sh
  fi
}
function introspect() {
    # 1. Determine which token to use
    # If $1 (argument) exists, use it. Otherwise, use the global $ACCESS_TOKEN.
    local token="${1:-$ACCESS_TOKEN}"

    # 2. If BOTH are empty, show an error
    if [ -z "$token" ]; then
        echo "Error: No token provided and \$ACCESS_TOKEN is not set."
        echo "Usage: introspect <token>  OR  export ACCESS_TOKEN=<token>"
        return 1
    fi

    # 3. Execute the curl
    curl -k -u "admin:admin" \
      -H 'Content-Type: application/x-www-form-urlencoded' \
      -X POST \
      --data "token=$token" \
      "https://localhost:9443/oauth2/introspect"
}

function gettoken() {
    # 1. Run the curl and store the full response in a local variable
    local response=$(curl -s -k --location 'https://idp.am.wso2.com:9095/oauth2/token' \
        --header 'Host: idp.am.wso2.com' \
        --header 'Authorization: Basic NDVmMWM1YzgtYTkyZS0xMWVkLWFmYTEtMDI0MmFjMTIwMDAyOjRmYmQ2MmVjLWE5MmUtMTFlZC1hZmExLTAyNDJhYzEyMDAwMg==' \
        --header 'Content-Type: application/x-www-form-urlencoded' \
        --data-urlencode 'grant_type=client_credentials' \
        --data-urlencode 'scope=apk:api_create')

    # 2. Print the raw response to the terminal (as requested)
    echo "$response"

    # 3. Extract the token and export it to the environment
    # Using jq (recommended)
    export ACCESS_TOKEN=$(echo "$response" | jq -r '.access_token')

    # Optional: Print a confirmation
    if [ "$ACCESS_TOKEN" != "null" ]; then
        echo "ACCESS_TOKEN has been updated."
    else
        echo "Failed to extract token."
    fi
}
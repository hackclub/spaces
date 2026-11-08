import { API_BASE } from "../config";

class UserData {
    user = $state<{
        username: string,
        email: string,
        is_admin: boolean,
        is_superadmin: boolean,
        permissions: string[],
        viewing_as: { id: number, name: string }[] | null,
        hackatime_api_key: string,
        hackclub_id: string,
        hackclub_verification_status: string,
        vscode_extensions: string
    }>()

    async refresh() {
        const response = await fetch(`${API_BASE}/users/me`, {
            credentials: "include",
        });
        const json = await response.json()
        if (json.success == false) {
            return false
        } else {
            this.user = json.data
            return true
        }
    }

    async viewAs(roleIds: number[]) {
        const secure = window.location.protocol === "https:" ? "; Secure" : ""
        document.cookie = `view_as=${roleIds.join(",")}; path=/; SameSite=Strict${secure}`
        return this.refresh()
    }

    async stopViewing() {
        document.cookie = "view_as=; path=/; max-age=0; SameSite=Strict"
        return this.refresh()
    }
}


export const userData = new UserData()
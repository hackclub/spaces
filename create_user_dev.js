import pg from "./src/utils/db.js"
import { hashToken, SESSION_MAX_AGE } from "./src/utils/sessions.js"
import readline from "readline"

const rl = new readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer)
        })
    })
}

async function main() {
    const email = (await askQuestion("Email for the dev account (press Enter for random@example.com): ")).trim() || "random@example.com"

    const [newUser] = await pg('users')
        .insert({
            email,
            username: "supercool",
            max_spaces: 3,
            is_admin: true,
            hackclub_verification_status: "verified_eligible"
        })
        .returning(['id', 'email', 'username', 'is_admin', 'hackatime_api_key', 'hackclub_id', 'hackclub_verification_status']);

    await pg('sessions').insert({
        user_id: newUser.id,
        token_hash: hashToken("w"),
        expires_at: new Date(Date.now() + SESSION_MAX_AGE)
    })

    console.log("user created!")
    console.dir(newUser)
    console.log('Log in by running this in your browser console on the dev site, then refresh: document.cookie = "auth_token=w; path=/"')
    process.exit(0)
}
main()
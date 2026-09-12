import pg from "./src/utils/db.js"
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
    const email = await askQuestion("What's the email you used to sign up to Hack Club? Make sure that account is idv verified. I could disable the check the backend does for account verificaton during dev but I'm too lazy :P")

    const [newUser] = await pg('users')
        .insert({
            email: "random@example.com",
            username: "supercool",
            authorization: "w",
            max_spaces: 3,
            is_admin: true,
            hackclub_verification_status: "verified_eligible"
        })
        .returning(['id', 'email', 'username', 'authorization', 'is_admin', 'hackatime_api_key', 'hackclub_id', 'hackclub_verification_status']);

    console.log("user created!")
    console.dir(newUser)
    process.exit(0)
}
main()
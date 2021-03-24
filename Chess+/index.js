//#region	//! Dependencies + Config fetch
const fs = require("fs");
const discord = require("discord.js");
const { createCanvas, loadImage } = require("canvas");
var botConfig;
generateLog('Initialised', '--------------------');
updateParameters();
//#endregion

//#region	//! Discord
const bot = new discord.Client();
// const token = fs.readFileSync("./appdata/token.txt", "utf-8");
const token = 'ODIzODU5MDU1Nzk2OTQ0OTA3.YFm8iQ.4ggXwHReB8D4Adpg06Z5O0H7TQw';
bot.login(token);
bot.on("ready", () => {
    generateLog('Ready', 'Bot');
    bot.user.setActivity("Ph4n d0ng", { type: "PLAYING" });
});
//#endregion

//#region	//! Canvas
const canvas = createCanvas(100, 100);
const ctx = canvas.getContext("2d");
const tileSize = botConfig.canvas.tileSize;
canvas.width = tileSize * 9.5;
canvas.height = tileSize * 10.5;
//
var lastMove = [];
const boardInit = [
    [-6, -5, -2, -3, -7, -3, -2, -5, -6],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, -4, 0, 0, 0, 0, 0, -4, 0],
    [-1, 0, -1, 0, -1, 0, -1, 0, -1],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 0, 1, 0, 1, 0, 1, 0, 1],
    [0, 4, 0, 0, 0, 0, 0, 4, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [6, 5, 2, 3, 7, 3, 2, 5, 6],
];
var board = JSON.parse(JSON.stringify(boardInit));
//#endregion

//#region	//! Load images
var bCannon, bElephant, bHorse, bKing, bPawn, bRook, bServant;
var wCannon, wElephant, wHorse, wKing, wPawn, wRook, wServant;
loadImage("./pieces/bCannon.svg").then((image) => {
    bCannon = image;
});
loadImage("./pieces/bElephant.svg").then((image) => {
    bElephant = image;
});
loadImage("./pieces/bHorse.svg").then((image) => {
    bHorse = image;
});
loadImage("./pieces/bKing.svg").then((image) => {
    bKing = image;
});
loadImage("./pieces/bPawn.svg").then((image) => {
    bPawn = image;
});
loadImage("./pieces/bRook.svg").then((image) => {
    bRook = image;
});
loadImage("./pieces/bServant.svg").then((image) => {
    bServant = image;
});
loadImage("./pieces/wCannon.svg").then((image) => {
    wCannon = image;
});
loadImage("./pieces/wElephant.svg").then((image) => {
    wElephant = image;
});
loadImage("./pieces/wHorse.svg").then((image) => {
    wHorse = image;
});
loadImage("./pieces/wKing.svg").then((image) => {
    wKing = image;
});
loadImage("./pieces/wPawn.svg").then((image) => {
    wPawn = image;
});
loadImage("./pieces/wRook.svg").then((image) => {
    wRook = image;
});
loadImage("./pieces/wServant.svg").then((image) => {
    wServant = image;
});
//#endregion

//#region   //! Class Definitions
class Game {
    constructor(whiteMember, blackMember, board = JSON.parse(JSON.stringify(boardInit))) {
        this.type = "Chinese Chess";
        this.whiteMember = whiteMember;
        this.blackMember = blackMember;
        this.board = board;
        this.isWhiteTurn = true;
        whiteMember.game = this;
        blackMember.game = this;
        this.startTime = getTimeStamp();
        //
        whiteMember.isInGame = true;
        blackMember.isInGame = true;
        whiteMember.opponent = blackMember;
        blackMember.opponent = whiteMember;
        //
        gameLog(this, "Initialised", "White: " + memberToLogFormat(whiteMember));
        gameLog(this, "Initialised", "Black: " + memberToLogFormat(blackMember));
    }
}
//#endregion
bot.on("message", (message) => {
    //#region   //? Spaghetti code
    if (message.member.id == bot.user.id) { return; }
    // if (!botConfig.discord.whitelistedChannels.includes(message.channel.id)) { return; }
    let content = message.content.toString();
    if (!botConfig.discord.commandPrefix.includes(content.substring(0, 1))) { return; }
    let args = content.substring(1).split(" ");
    args[0] = args[0].toLowerCase();
    console.log('Content: ' + message.content);
    console.log('Args: ' + args);
    //#endregion
    switch (args[0]) {
        //! Regular commands
        case 'invite':
            message.reply(createInvite(message.guild, message.member, message.guild.member(message.mentions.users.first())));
            break;
        case 'accept':
            message.reply(acceptInvite(message.guild, message.member, message.guild.member(message.mentions.users.first())));
            break;
        case 'decline':
            message.reply(declineInivte(message.guild, message.member, message.guild.member(message.mentions.users.first())));
            break;
        case 'hug':
            if (message.mentions.users.first() == bot.user) {
                if (!message.member.botIsAngryAt) {
                    message.reply(botConfig.flavourText.hug);
                    return;
                }
                if (Math.random() < botConfig.flavourText.apology.forgiveChance) { //accept apology
                    message.reply(botConfig.flavourText.apology.hug.accept);
                    message.member.botIsAngryAt = false;
                    return;
                } else { //not accept apology
                    message.reply(botConfig.flavourText.apology.hug.notAccept);
                    return;
                }
            }
            break;
        case 'sorry':
        case 'apologise':
        case 'apologize':
            if (message.mentions.users.first() == bot.user) {
                if (!message.member.botIsAngryAt) {
                    message.reply(botConfig.flavourText.apology.notAngry);
                    return;
                }
                if (Math.random() < botConfig.flavourText.apology.forgiveChance) { //accept apology
                    message.reply(botConfig.flavourText.apology.accept);
                    message.member.botIsAngryAt = false;
                    return;
                } else { //not accept apology
                    message.reply(botConfig.flavourText.apology.notAccept);
                    return;
                }
            }
            break;
        case "help":
            message.reply('\n' + botConfig.commandHelp);
            break;
        case "board":
            redraw();
            sendBoard(message.channel);
            break;
        case "move":
            var errorMessage = getUserByIDElseCreate(message.author.id).executeMove(args[1], args[2]);
            if (errorMessage) { message.reply(errorMessage); }
            sendBoard(message.channel);
            break;
        case "printstate":
            message.channel.send(JSON.stringify(board));
            break;
        case "material":
            var white = 0,
                black = 0;
            board.forEach((row) => {
                row.forEach((tile) => {
                    switch (tile) {
                        case 1:
                        case 2:
                        case 3:
                            white++;
                            break;
                        case 4:
                            white += 4;
                            break;
                        case 5:
                            white += 3;
                            break;
                        case 6:
                            white += 5;
                            break;
                        case -1:
                        case -2:
                        case -3:
                            black++;
                            break;
                        case -4:
                            black += 4;
                            break;
                        case -5:
                            black += 3;
                            break;
                        case -6:
                            black += 5;
                            break;
                        default:
                            break;
                    }
                });
            });
            message.channel.send(
                "White has " + white + " material points.\nBlack has " + black + " material points."
            );
            break;
        default:
            break;
    }
    //
    if (!botConfig.admin.commands.includes(args[0])) { return; }
    if (!botConfig.admin.IDlist.includes(message.member.id)) {
        message.reply(args[0] + " command is reserved for admin only!");
        return;
    }
    switch (args[0]) {
        //! Admin commands
        case 'updateparameters':
            updateParameters();
            message.reply("updated parameters");
            break;

        case "reset":
            board = JSON.parse(JSON.stringify(boardInit));
            lastMove = [];
            redraw();
            sendBoard(message.channel);
            break;
        case "forcemove":
            var errorMessage = forceMove(args[1], args[2]);
            if (errorMessage) {
                message.reply(errorMessage);
            }
            sendBoard(message.channel);
            break;
        case "add":
            var errorMessage = add(args[1], args[2]);
            if (errorMessage) {
                message.reply(errorMessage);
            }
            sendBoard(message.channel);
            break;
        case "enforcestate":
            board = JSON.parse(args[1]);
            lastMove = [];
            redraw();
            sendBoard(message.channel);
            message.reply("board state enforced");
            break;

        default:
            break;
    }
    return;
});

//#region   // Custom functions
//#region   //! Print interface
function sendBoard(channel) {
    const attachment = new discord.MessageAttachment(canvas.toBuffer("image/png"));
    channel.send(attachment);
    return;
}

function toCoords(x, y) {
    let xCoord;
    switch (x) {
        case 0:
            xCoord = "a";
            break;
        case 1:
            xCoord = "b";
            break;
        case 2:
            xCoord = "c";
            break;
        case 3:
            xCoord = "d";
            break;
        case 4:
            xCoord = "e";
            break;
        case 5:
            xCoord = "f";
            break;
        case 6:
            xCoord = "g";
            break;
        case 7:
            xCoord = "h";
            break;
        case 8:
            xCoord = "i";
            break;
        default:
            return false;
    }
    return xCoord + y;
}
//#endregion
//#region   //! Chessboard logic
function forceMove(home, goal) {
    if (!goal) {
        return "please input the destination";
    }
    //parsing
    let xHome = 0,
        xGoal = 0;
    let yHome = home.substring(1);
    let yGoal = goal.substring(1);
    let errorMessage = "";
    switch (home.substring(0, 1)) {
        case "i":
        case "I":
            xHome++;
        case "h":
        case "H":
            xHome++;
        case "g":
        case "G":
            xHome++;
        case "f":
        case "F":
            xHome++;
        case "e":
        case "E":
            xHome++;
        case "d":
        case "D":
            xHome++;
        case "c":
        case "C":
            xHome++;
        case "b":
        case "B":
            xHome++;
        case "a":
        case "A":
            break;
        default:
            errorMessage += "\nInvalid column: " + home.substring(0, 1);
            break;
    }
    if (!isWithinInclusiveRange(yHome, 0, 9)) {
        errorMessage += "\nInvalid row: " + yHome;
    }
    switch (goal.substring(0, 1)) {
        case "i":
        case "I":
            xGoal++;
        case "h":
        case "H":
            xGoal++;
        case "g":
        case "G":
            xGoal++;
        case "f":
        case "F":
            xGoal++;
        case "e":
        case "E":
            xGoal++;
        case "d":
        case "D":
            xGoal++;
        case "c":
        case "C":
            xGoal++;
        case "b":
        case "B":
            xGoal++;
        case "a":
        case "A":
            break;
        default:
            errorMessage += "\nInvalid column: " + goal.substring(0, 1);
            break;
    }
    if (!isWithinInclusiveRange(yGoal, 0, 9)) {
        errorMessage += "\nInvalid row: " + yGoal;
    }
    if (errorMessage) {
        return errorMessage;
    }
    //
    //executeMove
    board[9 - yGoal][xGoal] = board[9 - yHome][xHome];
    board[9 - yHome][xHome] = 0;
    redraw();
    return;
}

function add(piece, target) {
    if (!target) {
        return "please input the destination";
    }
    //parsing
    let xTarget = 0;
    let yTarget = target.substring(1);
    let errorMessage = "";
    if (!isWithinInclusiveRange(piece, -7, 7)) {
        errorMessage += "\nInvalid piece: " + piece;
    }
    switch (target.substring(0, 1)) {
        case "i":
        case "I":
            xGoal++;
        case "h":
        case "H":
            xGoal++;
        case "g":
        case "G":
            xGoal++;
        case "f":
        case "F":
            xGoal++;
        case "e":
        case "E":
            xGoal++;
        case "d":
        case "D":
            xGoal++;
        case "c":
        case "C":
            xGoal++;
        case "b":
        case "B":
            xGoal++;
        case "a":
        case "A":
            break;
        default:
            errorMessage += "\nInvalid column: " + goal.substring(0, 1);
            break;
    }
    if (!isWithinInclusiveRange(yTarget, 1, 10)) {
        errorMessage += "\nInvalid row: " + yTarget;
    }
    if (errorMessage) {
        return errorMessage;
    }
    //
    //add
    board[10 - yTarget][xTarget] = piece;
    redraw();
    return;
}
//
function logicCheck(xHome, yHome, xGoal, yGoal) {
    console.log(toCoords(xHome, yHome), toCoords(xGoal, yGoal));
    let hPiece = board[yHome][xHome];
    let gPiece = board[yGoal][xGoal];
    let dx = xGoal - xHome;
    let dy = yGoal - yHome;
    let hypot = Math.hypot(dx, dy);
    //
    //empty
    if (hPiece == 0) {
        return "nothing to move!";
    }
    //same coords
    if (dx == 0 && dy == 0) {
        return "running in place is not a valid move";
    }
    //friendly fire
    if (hPiece * gPiece > 0) {
        return "friendly fire is turned off!";
    }
    //piece logic
    switch (Math.abs(hPiece)) {
        case 1:
            {
                //pawn
                if (hypot != 1) {
                    return "pawns can only move forwards or sideways by one tile";
                }
                if (hPiece > 0) {
                    if (yGoal > yHome) {
                        return "pawns cannot move backwards";
                    }
                    if (yHome >= 5 && dx != 0) {
                        return "pawns cannot move sideways before they cross the river";
                    }
                } else {
                    if (yGoal < yHome) {
                        return "pawns cannot move backwards";
                    }
                    if (yHome <= 4 && dx != 0) {
                        return "pawns cannot move sideways before they cross the river";
                    }
                }
                return;
            }
        case 2:
            {
                //elephant
                if (hypot != 2 * Math.SQRT2) {
                    return "elephants can only move two tiles along a diagonal";
                }
                if (hPiece > 0 && yGoal <= 4) {
                    return "elephants cannot cross the river";
                }
                if (hPiece < 0 && yGoal >= 5) {
                    return "elephants cannot cross the river";
                }
                if (board[yHome + dy / 2][xHome + dx / 2] != 0) {
                    return (
                        "something at " +
                        toCoords(yHome + dy / 2, xHome + dx / 2) +
                        " is blocking the elephant"
                    );
                }
                return;
            }
        case 3:
            {
                //servant
                if (hypot != Math.SQRT2) {
                    return "servants can only move one tile along a diagonal";
                }
                if (!(xGoal >= 3 && xGoal <= 5)) {
                    return "servants cannot leave the palace";
                }
                if (hPiece > 0 && !(yGoal >= 7 && yGoal <= 9)) {
                    return "servants cannot leave the palace";
                }
                if (hPiece < 0 && !(yGoal >= 0 && yGoal <= 2)) {
                    return "servants cannot leave the palace";
                }
                return;
            }
        case 4:
            {
                //cannon
                if ((xGoal == xHome) | (yGoal == yHome)) {
                    //obstacle count
                    let obstacleCount = 0;
                    if (xGoal == xHome) {
                        //vertical
                        for (
                            let i = Math.min(yGoal, yHome) + 1; i < Math.max(yGoal, yHome); i++
                        ) {
                            if (board[i][xGoal] != 0) {
                                obstacleCount++;
                            }
                        }
                    } else {
                        //horizontal
                        for (
                            let i = Math.min(xGoal, xHome) + 1; i < Math.max(xGoal, xHome); i++
                        ) {
                            if (board[yGoal][i] != 0) {
                                obstacleCount++;
                            }
                        }
                    }
                    //
                    if (gPiece == 0 && obstacleCount > 0) {
                        return "something is blocking the cannon's path";
                    }
                    if (hPiece * gPiece < 0 && obstacleCount != 1) {
                        return "there must be exactly one obstacle in-between in order to capture";
                    }
                    return;
                }
                return "cannons can only move along an axis";
            }
        case 5:
            {
                //horse
                if (hypot != Math.sqrt(5)) {
                    return "horses can only move two tiles along an axis and one tile along another";
                }
                if (Math.abs(dx) > Math.abs(dy)) {
                    //horizontal
                    if (board[yHome][xHome + dx / 2] != 0) {
                        return (
                            "something at " +
                            toCoords(xHome + dx / 2, yHome) +
                            " is blocking the horse"
                        );
                    }
                } else {
                    //vertical
                    if (board[yHome + dy / 2][xHome] != 0) {
                        return (
                            "something at " +
                            toCoords(xHome, yHome + dy / 2) +
                            " is blocking the horse"
                        );
                    }
                }
                return;
            }
        case 6:
            {
                //rook
                if ((xGoal == xHome) | (yGoal == yHome)) {
                    if (xGoal == xHome) {
                        //vertical
                        for (
                            let i = Math.min(yGoal, yHome) + 1; i < Math.max(yGoal, yHome); i++
                        ) {
                            if (board[i][xGoal] != 0) {
                                return "something is blocking the rook's path";
                            }
                        }
                    } else {
                        //horizontal
                        for (
                            let i = Math.min(xGoal, xHome) + 1; i < Math.max(xGoal, xHome); i++
                        ) {
                            if (board[yGoal][i] != 0) {
                                return "something is blocking the rook's path";
                            }
                        }
                    }
                    return;
                }
                return "rooks can only move along an axis";
            }
        case 7:
            {
                //king
                if (hypot != 1) {
                    return "kings can only move one tile along an axis";
                }
                if (!(xGoal >= 3 && xGoal <= 5)) {
                    return "kings cannot leave the palace";
                }
                if (hPiece > 0 && !(yGoal >= 7 && yGoal <= 9)) {
                    return "kings cannot leave the palace";
                }
                if (hPiece < 0 && !(yGoal >= 0 && yGoal <= 2)) {
                    return "kings cannot leave the palace";
                }
                return;
            }
        default:
            {
                return "unknown error!";
            }
    }
}
//#endregion
//#region   //! Invite Management
function createInvite(guild, offerMember, receiverMember) { //* Return value is replied to message author
    generateLog("Create Invite", "Requested by " + memberToLogFormat(offerMember) + " regarding " + memberToLogFormat(receiverMember));
    if (!receiverMember) { //no @
        generateLog("Create Invite", "Denied " + memberToLogFormat(offerMember), "no mention");
        return botConfig.flavourText.invite.create.noMention;
    }
    if (offerMember == receiverMember) { //self invite
        generateLog("Create Invite", "Denied " + memberToLogFormat(offerMember), " inviting self");
        return botConfig.flavourText.invite.create.self;
    }
    if (receiverMember == guild.member(bot.user)) { //invite bot
        generateLog("Create Invite", "Denied " + memberToLogFormat(offerMember), "inviting bot");
        if (offerMember.botIsAngryAt) {
            return botConfig.flavourText.invite.create.botAngry;
        }
        return botConfig.flavourText.invite.create.bot;
    }
    if (!offerMember.invitingList) {
        offerMember.invitingList = [];
    }
    if (offerMember.invitingList.includes(receiverMember)) {
        generateLog("Create Invite", "Denied " + memberToLogFormat(offerMember), " already invited");
        return botConfig.flavourText.invite.create.alreadyInvited[0] + receiverMember.toString() + botConfig.flavourText.invite.create.alreadyInvited[1];
    }
    offerMember.invitingList.push(receiverMember);
    generateLog("Create Invite", "Successful by " + memberToLogFormat(offerMember) + " regarding " + memberToLogFormat(receiverMember));
    return botConfig.flavourText.invite.create.successful[0] + receiverMember.toString() + botConfig.flavourText.invite.create.successful[1];
}

function acceptInvite(guild, acceptorMember, inviterMember) { //* Return value is replied to message author
    generateLog("Accept Invite", "Requested by " + memberToLogFormat(acceptorMember) + " regarding " + memberToLogFormat(inviterMember));
    if (!inviterMember) { //no @
        generateLog("Accept Invite", "Denied " + memberToLogFormat(acceptorMember), "no mention");
        return botConfig.flavourText.invite.accept.noMention;
    }
    if (acceptorMember == inviterMember) { //self accept
        generateLog("Accept Invite", "Denied " + memberToLogFormat(acceptorMember), "accepting self");
        return botConfig.flavourText.invite.accept.self;
    }
    if (inviterMember == guild.member(bot.user)) { //decline bot
        generateLog("Accept Invite", "Denied " + memberToLogFormat(acceptorMember), "accepting bot");
        if (acceptorMember.botIsAngryAt) {
            return botConfig.flavourText.invite.accept.botAngry;
        }
        return botConfig.flavourText.invite.accept.bot;
    }
    if (!inviterMember.invitingList) {
        inviterMember.invitingList = [];
    }
    if (!inviterMember.invitingList.includes(acceptorMember)) {
        generateLog("Accept Invite", "Denied " + memberToLogFormat(acceptorMember), "not invited");
        return botConfig.flavourText.invite.accept.noInvite;
    }
    if (acceptorMember.isInGame) {
        generateLog("Accept Invite", "Denied " + memberToLogFormat(acceptorMember), "acceptor in game");
        return botConfig.flavourText.invite.accept.acceptorInGame;
    }
    if (inviterMember.isInGame) {
        generateLog("Accept Invite", "Denied " + memberToLogFormat(acceptorMember), "inviter in game");
        return inviterMember.toString() + botConfig.flavourText.invite.accept.inviterInGame[0] + inviterMember.opponent.toString() + botConfig.flavourText.invite.accept.inviterInGame[1];
    }
    for (let i = 0; i < inviterMember.invitingList.length; i++) {
        if (inviterMember.invitingList[i] == acceptorMember) {
            inviterMember.invitingList.splice(i, 1);
            generateLog("Accept Invite", "Successful by " + memberToLogFormat(acceptorMember) + " regarding " + memberToLogFormat(inviterMember));
            createGame(inviterMember, acceptorMember);
            return botConfig.flavourText.invite.accept.successful[0] + inviterMember.toString() + botConfig.flavourText.invite.accept.successful[1];
        }
    }
    generateLog("ERROR", memberToLogFormat(acceptorMember) + " regarding " + memberToLogFormat(inviterMember), botConfig.flavourText.invite.accept.error.loopEscaped);
    return botConfig.flavourText.invite.accept.error.loopEscaped;
}

function declineInivte(guild, declinerMember, inviterMember) { //* Return value is replied to message author
    generateLog("Decline Invite", "Requested by " + memberToLogFormat(declinerMember) + " regarding " + memberToLogFormat(inviterMember));
    if (!inviterMember) { //no @
        generateLog("Decline Invite", "Denied " + memberToLogFormat(declinerMember), "no mention");
        return botConfig.flavourText.invite.decline.noMention;
    }
    if (declinerMember == inviterMember) { //self decline
        generateLog("Decline Invite", "Denied " + memberToLogFormat(declinerMember), "declining self");
        return botConfig.flavourText.invite.decline.self;
    }
    if (inviterMember == guild.member(bot.user)) { //decline bot
        generateLog("Decline Invite", "Denied " + memberToLogFormat(declinerMember), "decling bot");
        if (declinerMember.botIsAngryAt) {
            return botConfig.flavourText.invite.decline.botAngry;
        }
        declinerMember.botIsAngryAt = true;
        return botConfig.flavourText.invite.decline.bot;
    }
    if (!inviterMember.invitingList) {
        inviterMember.invitingList = [];
    }
    if (!inviterMember.invitingList.includes(declinerMember)) {
        generateLog("Decline Invite", "Denied " + memberToLogFormat(declinerMember), "not invited");
        return botConfig.flavourText.invite.decline.noInvite;
    }
    for (let i = 0; i < inviterMember.invitingList.length; i++) {
        if (inviterMember.invitingList[i] == declinerMember) {
            inviterMember.invitingList.splice(i, 1);
            generateLog("Decline Invite", "Successful by " + memberToLogFormat(declinerMember) + " regarding " + memberToLogFormat(inviterMember));
            return botConfig.flavourText.invite.decline.successful[0] + inviterMember.toString() + botConfig.flavourText.invite.decline.successful[1];
        }
    }
    generateLog("ERROR", memberToLogFormat(declinerMember) + " regarding " + memberToLogFormat(inviterMember), botConfig.flavourText.invite.decline.error.loopEscaped);
    return botConfig.flavourText.invite.decline.error.loopEscaped;
}

function createGame(member1, member2) {
    if (Math.random() > 0.5) {
        new Game(member1, member2);
    } else {
        new Game(member2, member1);
    }
    return;
}
//#endregion
//#region   //! Draw functions
function redraw() {
    drawBoard();
    drawLastMove();
    drawPieces();
    drawCoords();
    return;
}

function drawLastMove() {
    drawLine(
        (lastMove[0] + 1) * tileSize,
        (lastMove[1] + 0.5) * tileSize,
        (lastMove[2] + 1) * tileSize,
        (lastMove[3] + 0.5) * tileSize,
        botConfig.canvas.palette.lastMoveLine
    );
    return;
}

function drawBoard() {
    drawRect(0, 0, canvas.width, canvas.height, botConfig.canvas.palette.outboard);
    drawRect(
        1 * tileSize,
        0.5 * tileSize,
        8 * tileSize,
        9 * tileSize,
        botConfig.canvas.palette.inboard
    );
    for (let i = 0; i < 9; i++) {
        drawLine(
            (i + 1) * tileSize,
            tileSize / 2,
            (i + 1) * tileSize,
            4.5 * tileSize,
            botConfig.canvas.palette.gridline
        );
    }
    for (let i = 0; i < 9; i++) {
        drawLine(
            (i + 1) * tileSize,
            5.5 * tileSize,
            (i + 1) * tileSize,
            9.5 * tileSize,
            botConfig.canvas.palette.gridline
        );
    }
    for (let i = 0; i < 10; i++) {
        drawLine(
            tileSize,
            (i + 0.5) * tileSize,
            9 * tileSize,
            (i + 0.5) * tileSize,
            botConfig.canvas.palette.gridline
        );
    }
    drawLine(tileSize, tileSize / 2, tileSize, 9.5 * tileSize);
    drawLine(9 * tileSize, tileSize / 2, 9 * tileSize, 9.5 * tileSize);
    drawLine(4 * tileSize, 0.5 * tileSize, 6 * tileSize, 2.5 * tileSize);
    drawLine(4 * tileSize, 2.5 * tileSize, 6 * tileSize, 0.5 * tileSize);
    drawLine(4 * tileSize, 7.5 * tileSize, 6 * tileSize, 9.5 * tileSize);
    drawLine(4 * tileSize, 9.5 * tileSize, 6 * tileSize, 7.5 * tileSize);
    return;
}

function drawRect(x1, y1, dx, dy, colour) {
    ctx.fillStyle = colour;
    ctx.fillRect(x1, y1, dx, dy);
    return;
}

function drawLine(x1, y1, x2, y2, colour) {
    ctx.closePath();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = tileSize / 12;
    ctx.strokeStyle = colour;
    ctx.stroke();
    ctx.closePath();
    return;
}

function drawPieces() {
    var piece;
    var noDraw = false;
    for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 9; j++) {
            switch (board[i][j]) {
                case 1:
                    {
                        piece = wPawn;
                        break;
                    }
                case 2:
                    {
                        piece = wElephant;
                        break;
                    }
                case 3:
                    {
                        piece = wServant;
                        break;
                    }
                case 4:
                    {
                        piece = wCannon;
                        break;
                    }
                case 5:
                    {
                        piece = wHorse;
                        break;
                    }
                case 6:
                    {
                        piece = wRook;
                        break;
                    }
                case 7:
                    {
                        piece = wKing;
                        break;
                    }
                case -1:
                    {
                        piece = bPawn;
                        break;
                    }
                case -2:
                    {
                        piece = bElephant;
                        break;
                    }
                case -3:
                    {
                        piece = bServant;
                        break;
                    }
                case -4:
                    {
                        piece = bCannon;
                        break;
                    }
                case -5:
                    {
                        piece = bHorse;
                        break;
                    }
                case -6:
                    {
                        piece = bRook;
                        break;
                    }
                case -7:
                    {
                        piece = bKing;
                        break;
                    }
                default:
                    {
                        noDraw = true;
                        break;
                    }
            }
            if (!noDraw) {
                ctx.drawImage(
                    piece,
                    (j + 0.5) * tileSize,
                    i * tileSize,
                    tileSize,
                    tileSize
                );
            }
            noDraw = false;
        }
    }
}

function drawCoords() {
    let coordText = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    for (let i = 1; i <= 10; i++) {
        drawText(10 - i, 0.45 * tileSize, (i - 0.35) * tileSize, "black", 2);
        if (i == 10) {
            return;
        }
        drawText(coordText[i - 1], i * tileSize, 10.3 * tileSize, "black", 0);
    }
    return;
}

function drawText(text, x, y, colour, align = 1) {
    ctx.font = "bold " + (tileSize / 8) * 3 + "px Trebuchet MS";
    ctx.fillStyle = colour;
    switch (align) {
        case 0:
            ctx.textAlign = "center";
            break;
        case 1:
            ctx.textAlign = "left";
            break;
        case 2:
            ctx.textAlign = "right";
            break;
        default:
            console.log("Unknown text-alignment: " + align);
            break;
    }
    ctx.fillText(text, x, y);
    return;
}
//#endregion
//#region   //! Math functions
function isWithinInclusiveRange(test, lower, upper) {
    if (lower > upper) {
        return isWithinInclusiveRange(test, upper, lower);
    }
    return lower <= test && test <= upper;
}
//#endregion
//#region   //! Meta
function updateParameters() {
    botConfig = JSON.parse(fs.readFileSync("./appdata/botConfig.json"));
    botConfig.commandHelp = fs.readFileSync("./appdata/commandHelp.txt", "utf-8");
    generateLog("Updated", "Parameters");
    return;
}

function getTimeStamp() {
    let d = new Date();
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear() + ', ' + d.toLocaleTimeString();
}

function getTimeStampYMD() {
    let d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 101).toString().substring(1) + '-' + (d.getDate() + 100).toString().substring(1) + ' ' + d.toLocaleTimeString().replace(":", "-").replace(":", "-");
}

function generateLog(action, content, reason) {
    let logMessage = getTimeStamp() + ' => ' + action + ': ' + content;
    if (reason) {
        logMessage += ', ' + reason;
    }
    console.log(logMessage);
    fs.appendFile('./appdata/log/botLog.txt', logMessage + '\n', function(err) { if (err) throw err; });
    return;
}

function memberToLogFormat(member) {
    if (!member) { return "(NULL member)" };
    return member.user.username + '(' + member.user.id + ')';
}

function channelToLogFormat(channel) {
    if (!channel) { return "(NULL channel)" }
    return channel.name + '(' + channel.id + ')';
}

function guildToLogFormat(guild) {
    if (!guild) { return "(NULL guild)" }
    return guild.name + '(' + guild.id + ')';
}
//#endregion
//#region   //! Game Logging
function gameLog(game, action, content) {
    let logMessage = getTimeStamp() + ' => ' + action + ': ' + content;
    switch (game.type) {
        case 'Chinese Chess':
            fs.appendFile("./appdata/log/games/Chinese Chess/" + getTimeStampYMD() + " " + game.whiteMember.id + " vs " + game.blackMember.id + ".txt ", logMessage + '\n', function(err) { if (err) throw err; });
            break;
        default:
            return;
    }
}
//#endregion
//#endregion

//#region	//? Pieces
/*
0: empty
1: pawn
2: elephant
3: servant
4: cannon
5: horse
6: rook
7: king
+: White    -: Black
*/
//#endregion
local.run = () => {
    console.log("Hello from test.js");
    global.secret = "this can be accessed by another script";
    local.secret = "this can't tho xd";
}

local.print = () => {
    console.log(global.secret);
    console.log(local.secret);
}

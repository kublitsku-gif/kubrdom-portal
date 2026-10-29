-- Stay-open launcher: reuse the CRM window and preserve its current page.
on run
    my showCRM()
end run

on reopen
    my showCRM()
end reopen

on idle
    return 60
end idle

on showCRM()
    tell application "Comet"
        repeat with w in windows
            if (title of w) contains "КубрДом CRM" then
                set minimized of w to false
                set index of w to 1
                activate
                return
            end if
        end repeat
    end tell
    do shell script "open -a 'Comet' --args --profile-directory=Default --app=https://portal.kubrdom.ru/crm"
end showCRM

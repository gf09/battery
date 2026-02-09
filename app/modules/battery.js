// Command line interactors
const { app } = require( 'electron' )
const { exec } = require( 'node:child_process' )
const { log, alert, wait, confirm } = require( './helpers' )
const { get_force_discharge_setting } = require( './settings' )
const { USER } = process.env
const path_fix = 'PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
const battery = `${ path_fix } battery`
const shell_options = {
    shell: '/bin/bash',
    env: { ...process.env, PATH: `${ process.env.PATH }:/usr/local/bin` }
}

// Execute without sudo
const exec_async_no_timeout = command => new Promise( ( resolve, reject ) => {

    log( `Executing ${ command }` )

    exec( command, shell_options, ( error, stdout, stderr ) => {

        if( error ) return reject( error, stderr, stdout )
        if( stderr ) return reject( stderr )
        if( stdout ) return resolve( stdout )
        if( !stdout ) return resolve( '' )

    } )

} )

const exec_async = ( command, timeout_in_ms=2000, throw_on_timeout=false ) => Promise.race( [
    exec_async_no_timeout( command ),
    wait( timeout_in_ms ).then( () => {
        if( throw_on_timeout ) throw new Error( `${ command } timed out` )
    } )
] )

// Execute with sudo
const exec_sudo_async = command => new Promise( ( resolve, reject ) => {

    log( `Executing ${ command } by running:` )
    log( `osascript -e "do shell script \\"${ command }\\" with administrator privileges"` )

    exec( `osascript -e "do shell script \\"${ command }\\" with administrator privileges"`, shell_options, ( error, stdout, stderr ) => {

        if( error ) return reject( error, stderr, stdout )
        if( stderr ) return reject( stderr )
        if( stdout ) return resolve( stdout )
        if( !stdout ) return resolve( '' )

    } )

} )

// Battery status checker
const get_battery_status = async () => {

    try {
        const message = await exec_async( `${ battery } status_csv` )
        let [ percentage='??', remaining='', charging='', discharging='', maintain_percentage='' ] = message?.split( ',' ) || []
        maintain_percentage = maintain_percentage.trim()
        maintain_percentage = maintain_percentage.length ? maintain_percentage : undefined
        charging = charging == 'enabled'
        discharging = discharging == 'discharging'
        remaining = remaining.match( /\d{1,2}:\d{1,2}/ ) ? remaining : 'unknown'

        let battery_state = `${ percentage }% (${ remaining } remaining)`
        let daemon_state = ``
        if( discharging ) daemon_state += `forcing discharge to ${ maintain_percentage || 80 }%`
        else daemon_state += `smc charging ${ charging ? 'enabled' : 'disabled' }`

        const status_object = { percentage, remaining, charging, discharging, maintain_percentage, battery_state, daemon_state }
        log( 'Battery status: ', JSON.stringify( status_object ) )
        return status_object

    } catch ( e ) {
        log( `Error getting battery status: `, e )
        alert( `Battery limiter error: ${ e.message }` )
    }

}

/* ///////////////////////////////
// Battery cli functions
// /////////////////////////////*/
const enable_battery_limiter = async () => {


    try {
        // Start battery maintainer
        const status = await get_battery_status()
        const allow_force_discharge = get_force_discharge_setting()
        await exec_async( `${ battery } maintain ${ status?.maintain_percentage || 80 }${ allow_force_discharge ? ' --force-discharge' : '' }` )
        log( `enable_battery_limiter exec complete` )
        return status?.percentage
    } catch ( e ) {
        log( 'Error enabling battery: ', e )
        alert( e.message )
    }

}

const disable_battery_limiter = async () => {

    try {
        await exec_async( `${ battery } maintain stop` )
        const status = await get_battery_status()
        return status?.percentage
    } catch ( e ) {
        log( 'Error enabling battery: ', e )
        alert( e.message )
    }

}

const log_err_return_false = ( ...errdata ) => {
    log( 'Error in shell call: ', ...errdata )
    return false
}

const initialize_battery = async () => {

    try {

        // Check if dev mode
        const { development, skipupdate } = process.env
        if( development ) log( `Dev mode on, skip updates: ${ skipupdate }` )

        // Check for network
        const online = await Promise.race( [
            exec_async( `${ path_fix } curl -I https://icanhazip.com &> /dev/null` ).then( () => true ).catch( () => false ),
            exec_async( `${ path_fix } curl -I https://github.com &> /dev/null` ).then( () => true ).catch( () => false )
        ] )
        log( `Internet online: ${ online }` )

        // Check if battery background executables are installed and owned by root.
        const [
            bin_dir_root_owned,     // This is important. Other software can potentially change the owner allowing for battery executable replacement.
            battery_installed,      // Make sure battery script exists and is root-owned.
            smc_installed,          // Make sure smc binary exists and is root-owned.
            silent_update_enabled   // Make sure visudo config is installed and allows passwordless update
        ] = await Promise.all( [
            exec_async( `${ path_fix } test "$(stat -f '%u' /usr/local/bin)" -eq 0` ).then( () => true ).catch( log_err_return_false ),
            exec_async( `${ path_fix } test "$(stat -f '%u' /usr/local/bin/battery)" -eq 0` ).then( () => true ).catch( log_err_return_false ),
            exec_async( `${ path_fix } test "$(stat -f '%u' /usr/local/bin/smc)" -eq 0` ).then( () => true ).catch( log_err_return_false ),
            exec_async( `${ path_fix } sudo -n /usr/local/bin/battery update_silent is_enabled` ).then( () => true ).catch( log_err_return_false )
        ] )
        const is_installed = bin_dir_root_owned && battery_installed && smc_installed && silent_update_enabled
        log( 'Is installed? ', is_installed, 'details: ', bin_dir_root_owned, battery_installed, smc_installed, silent_update_enabled )

        // Kill running instances of battery
        const processes = await exec_async( `ps aux | grep "/usr/local/bin/battery " | wc -l | grep -Eo "\\d*"` )
        log( `Found ${ `${ processes }`.replace( /\n/, '' ) } battery related processed to kill` )
        if( is_installed ) await exec_async( `${ battery } maintain stop` )
        await exec_async( `pkill -f "/usr/local/bin/battery.*"` ).catch( e => log( `Error killing existing battery processes, usually means no running processes` ) )

        // Reinstall or try updating
        if( !is_installed ) {
            log( `Installing battery for ${ USER }...` )
            if( !online ) return alert( `Battery needs an internet connection to download the latest version, please connect to the internet and open the app again.` )
            await alert( `Welcome to the Battery limiting tool. The app needs to install/update some components, so it will ask for your password. This should only be needed once.` )
            try {
                const result = await exec_sudo_async( `curl -s https://raw.githubusercontent.com/actuallymentor/battery/main/setup.sh | bash -s -- $USER` )
                log( `Install result success `, result )
                await alert( `Battery background components installed/updated successfully. You can find the battery limiter icon in the top right of your menu bar.` )
            } catch ( e ) {
                log( `Battery setup failed: `, e )
                await alert( `Failed to install battery background components.\n\n${e.message}`)
                app.quit()
                app.exit()
            }
        } else {
            // Try updating to the latest version
            if( !online ) return log( `Skipping battery update because we are offline` )
            if( skipupdate ) return log( `Skipping update due to environment variable` )
            log( `Updating battery...` )
            try {
                const result = await exec_async( `${ path_fix } sudo -n /usr/local/bin/battery update_silent` )
                log( `Update details: `, result )
            } catch ( e ) {
                log( `Battery update failed: `, e )
                await alert( `Couldn’t complete the update.\n\n${e.message}`)
            }
        }

        // Basic user tracking on app open, run it in the background so it does not cause any delay for the user
        if( online ) exec_async( `nohup curl "https://unidentifiedanalytics.web.app/touch/?namespace=battery" > /dev/null 2>&1` )

    } catch ( e ) {
        log( `Error Initializing battery: `, e )
        await alert( `Battery limiter initialization error: ${ e.message }` )
        app.quit()
        app.exit()
    }

}

const uninstall_battery = async () => {

    try {
        const confirmed = await confirm( `Are you sure you want to uninstall Battery?` )
        if( !confirmed ) return false
        await exec_sudo_async( `${ path_fix } sudo battery uninstall silent` )
        await alert( `Battery is now uninstalled!` )
        return true
    } catch ( e ) {
        log( 'Error uninstalling battery: ', e )
        alert( `Error uninstalling battery: ${ e.message }` )
        return false
    }

}

const is_limiter_enabled = async () => {

    try {
        const message = await exec_async( `${ battery } status` )
        log( `Limiter status message: `, message )
        return message?.includes( 'being maintained at' )
    } catch ( e ) {
        log( `Error getting battery status: `, e )
        alert( `Battery limiter error: ${ e.message }` )
    }

}

module.exports = {
    enable_battery_limiter,
    disable_battery_limiter,
    initialize_battery,
    is_limiter_enabled,
    get_battery_status,
    uninstall_battery
}

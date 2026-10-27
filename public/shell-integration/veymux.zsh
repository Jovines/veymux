# Veymux shell integration for zsh.
# Based on Ghostty's zsh integration (GPL-3.0), adapted for veymux.
#
# Emits:
#   OSC 133;A — prompt start (precmd)
#   OSC 133;C — command start (preexec)
#   OSC 133;D;exitcode — command end (precmd)
#   OSC 2;title — window title (cwd when idle, command when running)
#   OSC 7;cwd — current working directory

_entrypoint() {
    builtin emulate -L zsh -o no_warn_create_global -o no_aliases

    [[ -o interactive ]]              || builtin return 0
    (( ! $+_veymux_state ))         || builtin return 0

    builtin typeset -gi _veymux_state
    # 0: no OSC 133 [AC] marks yet. 1: last C not closed with D. 2: other.

    # Open a private fd to the TTY so OSC sequences reach the terminal
    # even when stdout is redirected.
    typeset -gi _veymux_fd
    {
        builtin zmodload zsh/system && (( $+builtins[sysopen] )) && {
            { [[ -w     $TTY ]] && builtin sysopen -o cloexec -wu _veymux_fd --     $TTY } ||
            { [[ -w /dev/tty ]] && builtin sysopen -o cloexec -wu _veymux_fd -- /dev/tty }
        }
    } 2>/dev/null || (( _veymux_fd = 1 ))

    builtin typeset -ag precmd_functions
    precmd_functions+=(_veymux_deferred_init)
}

_veymux_deferred_init() {
    builtin emulate -L zsh -o no_warn_create_global -o no_aliases

    _veymux_precmd() {
        builtin local -i cmd_status=$?
        builtin emulate -L zsh -o no_warn_create_global -o no_aliases

        if ! builtin zle; then
            if (( _veymux_state == 1 )); then
                builtin print -nu $_veymux_fd '\e]133;D;'$cmd_status'\a'
                (( _veymux_state = 2 ))
            elif (( _veymux_state == 2 )); then
                builtin print -nu $_veymux_fd '\e]133;D\a'
            fi
        fi

        builtin local mark1=$'%{\e]133;A;cl=line\a%}'
        if [[ -o prompt_percent ]]; then
            builtin typeset -g precmd_functions
            if [[ ${precmd_functions[-1]} == _veymux_precmd ]]; then
                builtin local ps1_changed=0
                if [[ -n ${_veymux_saved_ps1+x} ]]; then
                    if [[ $PS1 == $_veymux_marked_ps1 ]]; then
                        PS1=$_veymux_saved_ps1
                        PS2=$_veymux_saved_ps2
                    elif [[ $PS1 != $_veymux_saved_ps1 ]]; then
                        ps1_changed=1
                    fi
                fi

                _veymux_saved_ps1=$PS1
                _veymux_saved_ps2=$PS2

                builtin local mark2=$'%{\e]133;P;k=s\a%}'
                builtin local markB=$'%{\e]133;B\a%}'
                [[ $PS1 == *[^%]% || $PS1 == % ]] && PS1=$PS1%
                PS1=${mark1}${PS1}${markB}

                if (( ! ps1_changed )) && [[ $PS1 == *$'\n'* ]]; then
                    PS1=${PS1//$'\n'/$'\n'${mark2}}
                fi

                [[ $PS2 == *[^%]% || $PS2 == % ]] && PS2=$PS2%
                PS2=${mark2}${PS2}${markB}

                _veymux_marked_ps1=$PS1
                (( _veymux_state = 2 ))
            else
                precmd_functions=(${precmd_functions:#_veymux_precmd} _veymux_precmd)
                if ! builtin zle; then
                    builtin print -rnu $_veymux_fd -- $mark1[3,-3]
                    (( _veymux_state = 2 ))
                fi
            fi
        elif ! builtin zle; then
            builtin print -rnu $_veymux_fd -- $mark1[3,-3]
            (( _veymux_state = 2 ))
        fi

        # Title: cwd when idle
        builtin print -rnu $_veymux_fd $'\e]2;'"${(%):-%(4~|…/%3~|%~)}"$'\a'

        # Report cwd
        builtin print -nu $_veymux_fd '\e]7;kitty-shell-cwd://'"$HOST""$PWD"'\a'
    }

    _veymux_preexec() {
        builtin emulate -L zsh -o no_warn_create_global -o no_aliases

        if [[ -n ${_veymux_saved_ps1+x} && $PS1 == $_veymux_marked_ps1 ]]; then
            PS1=$_veymux_saved_ps1
            PS2=$_veymux_saved_ps2
        fi

        # Title: command name when running
        builtin print -rnu $_veymux_fd $'\e]2;'"${1//[[:cntrl:]]}"$'\a'

        # End of input, start of output
        builtin print -nu $_veymux_fd '\e]133;C\a'
        (( _veymux_state = 1 ))
    }

    # Emit prompt marks at line-init if PS1 doesn't contain our marks
    (( $+functions[_veymux_zle_line_init] )) || _veymux_zle_line_init() { builtin true; }
    functions[_veymux_zle_line_init]="
        if [[ \$PS1 != *$'%{\\e]133;A'* ]]; then
            builtin print -nu \$_veymux_fd '\\e]133;P;k=i\\a\\e]133;B\\a'
        fi
    "${functions[_veymux_zle_line_init]}

    builtin local hook func widget orig_widget flag
    for hook in line-init line-finish keymap-select; do
        func=_veymux_zle_${hook/-/_}
        (( $+functions[$func] )) || builtin continue
        widget=zle-$hook
        if [[ $widgets[$widget] == user:azhw:* &&
              $+functions[add-zle-hook-widget] -eq 1 ]]; then
            add-zle-hook-widget $hook $func
        else
            if (( $+widgets[$widget] )); then
                orig_widget=._veymux_orig_$widget
                builtin zle -A $widget $orig_widget
                if [[ $widgets[$widget] == user:* ]]; then
                    flag=
                else
                    flag=w
                fi
                functions[$func]+="
                    builtin zle $orig_widget -N$flag -- \"\$@\""
            fi
            builtin zle -N $widget $func
        fi
    done

    if (( $+functions[_veymux_preexec] )); then
        builtin typeset -ag preexec_functions
        preexec_functions+=(_veymux_preexec)
    fi

    builtin typeset -ag precmd_functions
    if (( $+functions[_veymux_precmd] )); then
        precmd_functions=(${precmd_functions:#_veymux_deferred_init} _veymux_precmd)
        _veymux_precmd
    else
        precmd_functions=(${precmd_functions:#_veymux_deferred_init})
    fi

    builtin unfunction _veymux_deferred_init
}

_entrypoint

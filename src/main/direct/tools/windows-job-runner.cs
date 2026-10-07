// Direct's Windows command runner (see windows-job-runner.js and
// docs/DIRECT_WINDOWS_CONTAINMENT_DECISION.md).
//
// Runs one command line inside a fresh Job Object with KILL_ON_JOB_CLOSE and
// no breakaway. Only this process holds the job handle, so the whole process
// tree dies when this process dies for any reason: killed by the host, the
// host crashing (libuv's own job then kills this process), or the command
// exiting, after which the job is terminated explicitly.
//
// Usage:
//   direct-job-runner.exe [--integrity medium|low|low-read-only]
//                         [--label-low <dir>] [--hide <file>]... [--scratch <dir>]
//                         --cmdline-b64 <base64 utf-8 command line>
//
//   --integrity low            Workspace: Low integrity; writes land only in
//                              folders labeled Low (the project, --scratch).
//   --integrity low-read-only  Read only: Low integrity plus a write-restricted
//                              token; only --scratch is writable.
//   --label-low <dir>          Ensure <dir> carries an inheritable Low label.
//   --hide <file>              Ensure <file> carries a Medium no-read-up label,
//                              so Low-integrity commands cannot read it.
//   --scratch <dir>            Create <dir> as the command's private TEMP:
//                              Low label, DACL for this user and logon session.
//
//   --conpty <rows> <cols>     Run the command in a pseudoconsole (ConPTY) of
//                              that size. stdout then carries the terminal's
//                              output, and stdin carries frames: one type byte,
//                              a 4-byte big-endian length, the payload.
//                                'd' bytes typed into the terminal
//                                'r' resize: rows, cols (2-byte big-endian each)
//                                'k' signal name: SIGINT types Ctrl+C, any
//                                    other signal ends the job
//                              stdin closing (the host is gone) ends the job.
//
// Exit code: the command's, or 125 when the runner itself fails (message on
// stderr, prefixed "direct-job-runner:").
//
// Built at first use by the .NET Framework compiler that ships with Windows
// (csc.exe v4.0.30319), so the C# stays at language version 5.

using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

static class DirectJobRunner
{
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const int PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
    const int MAX_FRAME_BYTES = 1 << 20;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const int STARTF_USESTDHANDLES = 0x00000100;
    const uint HANDLE_FLAG_INHERIT = 0x00000001;
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const uint INFINITE = 0xFFFFFFFF;
    const int TokenGroups = 2;
    const int TokenDefaultDacl = 6;
    const int TokenIntegrityLevel = 25;
    const uint TOKEN_DUPLICATE = 0x0002;
    const uint TOKEN_QUERY = 0x0008;
    const uint TOKEN_ADJUST_DEFAULT = 0x0080;
    const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
    const uint MAXIMUM_ALLOWED = 0x02000000;
    const uint SE_GROUP_INTEGRITY = 0x00000020;
    const uint SE_GROUP_LOGON_ID = 0xC0000000;
    const uint WRITE_RESTRICTED = 0x8;
    const int SE_FILE_OBJECT = 1;
    const uint DACL_SECURITY_INFORMATION = 0x4;
    const uint LABEL_SECURITY_INFORMATION = 0x10;
    const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct COORD
    {
        public short X, Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SID_AND_ATTRIBUTES
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_MANDATORY_LABEL
    {
        public SID_AND_ATTRIBUTES Label;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_DEFAULT_DACL
    {
        public IntPtr DefaultDacl;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string app, StringBuilder cmdline, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(IntPtr token, string app, StringBuilder cmdline, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateProcessW")]
    static extern bool CreateProcessEx(string app, StringBuilder cmdline, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateProcessAsUserW")]
    static extern bool CreateProcessAsUserEx(IntPtr token, string app, StringBuilder cmdline, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CreatePipe(out IntPtr read, out IntPtr write, IntPtr attributes, int size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int CreatePseudoConsole(COORD size, IntPtr input, IntPtr output, uint flags, out IntPtr console);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int ResizePseudoConsole(IntPtr console, COORD size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern void ClosePseudoConsole(IntPtr console);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int impersonationLevel, int tokenType, out IntPtr newToken);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool CreateRestrictedToken(IntPtr token, uint flags, uint disableSidCount, IntPtr sidsToDisable, uint deletePrivilegeCount, IntPtr privilegesToDelete, uint restrictedSidCount, SID_AND_ATTRIBUTES[] sidsToRestrict, out IntPtr newToken);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr buffer, int length, out int returned);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ConvertStringSidToSid(string sid, out IntPtr psid);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ConvertSidToStringSid(IntPtr sid, out string sidString);
    [DllImport("advapi32.dll")]
    static extern int GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SetTokenInformation(IntPtr token, int infoClass, ref TOKEN_MANDATORY_LABEL info, int length);
    [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "SetTokenInformation")]
    static extern bool SetTokenDefaultDacl(IntPtr token, int infoClass, ref TOKEN_DEFAULT_DACL info, int length);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr sd, out uint size);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr sd, uint revision, uint info, out string sddl, out uint length);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetSecurityDescriptorSacl(IntPtr sd, out bool present, out IntPtr sacl, out bool defaulted);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetSecurityDescriptorDacl(IntPtr sd, out bool present, out IntPtr dacl, out bool defaulted);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern uint GetNamedSecurityInfo(string name, int objectType, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl, out IntPtr sd);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern uint SetNamedSecurityInfo(string name, int objectType, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);

    static void Fail(string what)
    {
        Fail(what, Marshal.GetLastWin32Error());
    }

    static void Fail(string what, int code)
    {
        Console.Error.WriteLine("direct-job-runner: " + what + " failed: " + new Win32Exception(code).Message + " (" + code + ")");
        Environment.Exit(125);
    }

    static IntPtr OwnToken()
    {
        IntPtr self;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT | TOKEN_ASSIGN_PRIMARY, out self)) Fail("OpenProcessToken");
        return self;
    }

    static IntPtr LogonSid(IntPtr token)
    {
        int size;
        GetTokenInformation(token, TokenGroups, IntPtr.Zero, 0, out size);
        IntPtr buffer = Marshal.AllocHGlobal(size);
        if (!GetTokenInformation(token, TokenGroups, buffer, size, out size)) Fail("GetTokenInformation");
        int count = Marshal.ReadInt32(buffer);
        int entrySize = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
        // TOKEN_GROUPS: a DWORD count, then the array at pointer alignment.
        IntPtr entries = new IntPtr(buffer.ToInt64() + IntPtr.Size);
        for (int i = 0; i < count; i++)
        {
            SID_AND_ATTRIBUTES entry = (SID_AND_ATTRIBUTES)Marshal.PtrToStructure(new IntPtr(entries.ToInt64() + i * entrySize), typeof(SID_AND_ATTRIBUTES));
            if ((entry.Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID) return entry.Sid;
        }
        Console.Error.WriteLine("direct-job-runner: the process token has no logon SID");
        Environment.Exit(125);
        return IntPtr.Zero;
    }

    static string SidString(IntPtr sid)
    {
        string text;
        if (!ConvertSidToStringSid(sid, out text)) Fail("ConvertSidToStringSid");
        return text;
    }

    static IntPtr SecurityDescriptor(string sddl)
    {
        IntPtr sd;
        uint size;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out sd, out size)) Fail("ConvertStringSecurityDescriptorToSecurityDescriptor");
        return sd;
    }

    static string CurrentLabel(string path)
    {
        IntPtr sd;
        uint error = GetNamedSecurityInfo(path, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out sd);
        if (error != 0) Fail("GetNamedSecurityInfo(" + path + ")", (int)error);
        string sddl;
        uint length;
        if (!ConvertSecurityDescriptorToStringSecurityDescriptor(sd, 1, LABEL_SECURITY_INFORMATION, out sddl, out length)) Fail("ConvertSecurityDescriptorToStringSecurityDescriptor");
        return sddl ?? "";
    }

    static void SetLabel(string path, string labelSddl)
    {
        IntPtr sd = SecurityDescriptor(labelSddl);
        IntPtr sacl;
        bool present, defaulted;
        if (!GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted)) Fail("GetSecurityDescriptorSacl");
        uint error = SetNamedSecurityInfo(path, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
        if (error != 0) Fail("SetNamedSecurityInfo(" + path + ")", (int)error);
    }

    // The label is checked first because setting an inheritable label walks
    // the whole tree; only the first Workspace command in a folder pays that.
    static void EnsureLowLabel(string dir)
    {
        string current = CurrentLabel(dir);
        if (current.Contains("(ML;OICI;NW;;;LW)") || current.Contains("(ML;OICIID;NW;;;LW)")) return;
        SetLabel(dir, "S:(ML;OICI;NW;;;LW)");
    }

    static void EnsureHidden(string file)
    {
        if (!File.Exists(file)) return;
        string current = CurrentLabel(file);
        if (current.Contains("NWNR;;;ME)") || current.Contains("NRNW;;;ME)")) return;
        SetLabel(file, "S:(ML;;NWNR;;;ME)");
    }

    static void CreateScratch(string dir, IntPtr token)
    {
        Directory.CreateDirectory(dir);
        string user = WindowsIdentity.GetCurrent().User.Value;
        string logon = SidString(LogonSid(token));
        // Granting the logon SID is what lets a write-restricted token write
        // here: the logon SID is one of its restricting SIDs.
        IntPtr sd = SecurityDescriptor("D:P(A;OICI;FA;;;" + user + ")(A;OICI;FA;;;" + logon + ")(A;OICI;FA;;;SY)S:(ML;OICI;NW;;;LW)");
        IntPtr dacl, sacl;
        bool present, defaulted;
        if (!GetSecurityDescriptorDacl(sd, out present, out dacl, out defaulted)) Fail("GetSecurityDescriptorDacl");
        if (!GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted)) Fail("GetSecurityDescriptorSacl");
        uint error = SetNamedSecurityInfo(dir, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION, IntPtr.Zero, IntPtr.Zero, dacl, sacl);
        if (error != 0) Fail("SetNamedSecurityInfo(" + dir + ")", (int)error);
    }

    static IntPtr LowIntegrityToken(IntPtr self, bool writeRestricted)
    {
        IntPtr low, sid;
        if (writeRestricted)
        {
            // Restricting SIDs: Everyone, and the logon SID, without which
            // processes cannot reach their window station and fail DLL
            // initialization (STATUS_DLL_INIT_FAILED).
            IntPtr everyone;
            if (!ConvertStringSidToSid("S-1-1-0", out everyone)) Fail("ConvertStringSidToSid");
            SID_AND_ATTRIBUTES[] restricting = new SID_AND_ATTRIBUTES[2];
            restricting[0].Sid = everyone;
            restricting[1].Sid = LogonSid(self);
            if (!CreateRestrictedToken(self, WRITE_RESTRICTED, 0, IntPtr.Zero, 0, IntPtr.Zero, 2, restricting, out low)) Fail("CreateRestrictedToken");
            // Objects the command creates (pipes, child processes) get the
            // token's default DACL, which grants only the user, so the
            // restricted check would refuse writes to them. Grant the logon
            // SID, which passes both checks.
            IntPtr dacl;
            bool present, defaulted;
            IntPtr sd = SecurityDescriptor("D:(A;;GA;;;" + SidString(restricting[1].Sid) + ")(A;;GA;;;SY)");
            if (!GetSecurityDescriptorDacl(sd, out present, out dacl, out defaulted)) Fail("GetSecurityDescriptorDacl");
            TOKEN_DEFAULT_DACL defaultDacl = new TOKEN_DEFAULT_DACL();
            defaultDacl.DefaultDacl = dacl;
            if (!SetTokenDefaultDacl(low, TokenDefaultDacl, ref defaultDacl, Marshal.SizeOf(typeof(TOKEN_DEFAULT_DACL)))) Fail("SetTokenInformation(TokenDefaultDacl)");
        }
        // SecurityImpersonation = 2, TokenPrimary = 1
        else if (!DuplicateTokenEx(self, MAXIMUM_ALLOWED, IntPtr.Zero, 2, 1, out low)) Fail("DuplicateTokenEx");
        if (!ConvertStringSidToSid("S-1-16-4096", out sid)) Fail("ConvertStringSidToSid");
        TOKEN_MANDATORY_LABEL label = new TOKEN_MANDATORY_LABEL();
        label.Label.Sid = sid;
        label.Label.Attributes = SE_GROUP_INTEGRITY;
        if (!SetTokenInformation(low, TokenIntegrityLevel, ref label, Marshal.SizeOf(typeof(TOKEN_MANDATORY_LABEL)) + GetLengthSid(sid))) Fail("SetTokenInformation(TokenIntegrityLevel)");
        return low;
    }

    static COORD Size(int rows, int cols)
    {
        COORD size = new COORD();
        size.X = (short)Math.Max(1, Math.Min(cols, 1000));
        size.Y = (short)Math.Max(1, Math.Min(rows, 1000));
        return size;
    }

    static bool ReadExactly(Stream stream, byte[] buffer, int count)
    {
        int offset = 0;
        while (offset < count)
        {
            int read = stream.Read(buffer, offset, count - offset);
            if (read <= 0) return false;
            offset += read;
        }
        return true;
    }

    // stdin frames for a pseudoconsole: typed bytes, resize, signal. When
    // stdin ends, the host is gone, so the command ends too.
    static void RelayFrames(Stream frames, Stream terminalInput, IntPtr console, IntPtr job)
    {
        byte[] header = new byte[5];
        try
        {
            while (ReadExactly(frames, header, 5))
            {
                int length = (header[1] << 24) | (header[2] << 16) | (header[3] << 8) | header[4];
                if (length < 0 || length > MAX_FRAME_BYTES) break;
                byte[] payload = new byte[length];
                if (!ReadExactly(frames, payload, length)) break;
                char kind = (char)header[0];
                if (kind == 'd')
                {
                    terminalInput.Write(payload, 0, length);
                    terminalInput.Flush();
                }
                else if (kind == 'r' && length == 4)
                {
                    ResizePseudoConsole(console, Size((payload[0] << 8) | payload[1], (payload[2] << 8) | payload[3]));
                }
                else if (kind == 'k')
                {
                    if (Encoding.ASCII.GetString(payload) == "SIGINT")
                    {
                        terminalInput.WriteByte(3);
                        terminalInput.Flush();
                    }
                    else
                    {
                        TerminateJobObject(job, 130);
                        return;
                    }
                }
            }
        }
        catch (IOException)
        {
        }
        TerminateJobObject(job, 130);
    }

    static int RunInPseudoConsole(IntPtr job, string cmdline, IntPtr token, int rows, int cols)
    {
        IntPtr inputRead, inputWrite, outputRead, outputWrite;
        if (!CreatePipe(out inputRead, out inputWrite, IntPtr.Zero, 0)) Fail("CreatePipe(input)");
        if (!CreatePipe(out outputRead, out outputWrite, IntPtr.Zero, 0)) Fail("CreatePipe(output)");
        IntPtr console;
        int result = CreatePseudoConsole(Size(rows, cols), inputRead, outputWrite, 0, out console);
        if (result != 0) Fail("CreatePseudoConsole", result);
        // The pseudoconsole keeps its own copies of these ends.
        CloseHandle(inputRead);
        CloseHandle(outputWrite);

        IntPtr listSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref listSize);
        IntPtr attributes = Marshal.AllocHGlobal(listSize);
        if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref listSize)) Fail("InitializeProcThreadAttributeList");
        if (!UpdateProcThreadAttribute(attributes, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, console, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) Fail("UpdateProcThreadAttribute");
        STARTUPINFOEX si = new STARTUPINFOEX();
        si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
        // Without this, Windows hands the child this runner's own redirected
        // stdin/stdout (the frame pipe) instead of the pseudoconsole, and the
        // shell reads raw frames in parallel with the relay. Null handles
        // make it use the pseudoconsole.
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        si.StartupInfo.hStdInput = IntPtr.Zero;
        si.StartupInfo.hStdOutput = IntPtr.Zero;
        si.StartupInfo.hStdError = IntPtr.Zero;
        si.lpAttributeList = attributes;

        PROCESS_INFORMATION pi;
        StringBuilder line = new StringBuilder(cmdline);
        // Suspended until it is in the job; no handles inherited, the
        // pseudoconsole is its terminal.
        uint flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT;
        bool created = token != IntPtr.Zero
            ? CreateProcessAsUserEx(token, null, line, IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, null, ref si, out pi)
            : CreateProcessEx(null, line, IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, null, ref si, out pi);
        if (!created) Fail(token != IntPtr.Zero ? "CreateProcessAsUser" : "CreateProcess");
        if (!AssignProcessToJobObject(job, pi.hProcess))
        {
            int code = Marshal.GetLastWin32Error();
            TerminateProcess(pi.hProcess, 125);
            Fail("AssignProcessToJobObject", code);
        }

        Stream stdout = Console.OpenStandardOutput();
        FileStream terminalOutput = new FileStream(new SafeFileHandle(outputRead, true), FileAccess.Read, 1, false);
        FileStream terminalInput = new FileStream(new SafeFileHandle(inputWrite, true), FileAccess.Write, 1, false);
        Thread output = new Thread(delegate()
        {
            byte[] buffer = new byte[8192];
            try
            {
                int read;
                while ((read = terminalOutput.Read(buffer, 0, buffer.Length)) > 0)
                {
                    stdout.Write(buffer, 0, read);
                    stdout.Flush();
                }
            }
            catch (IOException)
            {
            }
        });
        output.IsBackground = true;
        output.Start();
        Thread input = new Thread(delegate() { RelayFrames(Console.OpenStandardInput(), terminalInput, console, job); });
        input.IsBackground = true;
        input.Start();

        ResumeThread(pi.hThread);
        WaitForSingleObject(pi.hProcess, INFINITE);
        uint exitCode;
        GetExitCodeProcess(pi.hProcess, out exitCode);
        TerminateJobObject(job, exitCode);
        // Closing the pseudoconsole flushes its last output and ends the stream.
        ClosePseudoConsole(console);
        output.Join(2000);
        stdout.Flush();
        return (int)exitCode;
    }

    static int Main(string[] args)
    {
        string integrity = "medium";
        string cmdline = null;
        string labelLow = null;
        string scratch = null;
        int ptyRows = 0, ptyCols = 0;
        System.Collections.Generic.List<string> hidden = new System.Collections.Generic.List<string>();
        for (int i = 0; i < args.Length; i++)
        {
            bool hasValue = i + 1 < args.Length;
            if (args[i] == "--integrity" && hasValue) integrity = args[++i];
            else if (args[i] == "--conpty" && i + 2 < args.Length)
            {
                ptyRows = int.Parse(args[++i]);
                ptyCols = int.Parse(args[++i]);
            }
            else if (args[i] == "--cmdline-b64" && hasValue) cmdline = Encoding.UTF8.GetString(Convert.FromBase64String(args[++i]));
            else if (args[i] == "--label-low" && hasValue) labelLow = args[++i];
            else if (args[i] == "--hide" && hasValue) hidden.Add(args[++i]);
            else if (args[i] == "--scratch" && hasValue) scratch = args[++i];
            else
            {
                Console.Error.WriteLine("direct-job-runner: unknown argument " + args[i]);
                return 125;
            }
        }
        if (string.IsNullOrEmpty(cmdline))
        {
            Console.Error.WriteLine("direct-job-runner: --cmdline-b64 is required");
            return 125;
        }
        if (integrity != "medium" && integrity != "low" && integrity != "low-read-only")
        {
            Console.Error.WriteLine("direct-job-runner: unknown integrity " + integrity);
            return 125;
        }

        IntPtr self = OwnToken();
        if (labelLow != null) EnsureLowLabel(labelLow);
        foreach (string file in hidden) EnsureHidden(file);
        if (scratch != null) CreateScratch(scratch, self);

        // Not inheritable: a descendant holding the handle would keep the job alive.
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) Fail("CreateJobObject");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)))) Fail("SetInformationJobObject");

        if (ptyRows > 0 && ptyCols > 0)
        {
            IntPtr ptyToken = integrity != "medium" ? LowIntegrityToken(self, integrity == "low-read-only") : IntPtr.Zero;
            return RunInPseudoConsole(job, cmdline, ptyToken, ptyRows, ptyCols);
        }

        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(-10);
        si.hStdOutput = GetStdHandle(-11);
        si.hStdError = GetStdHandle(-12);
        SetHandleInformation(si.hStdInput, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        SetHandleInformation(si.hStdOutput, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        SetHandleInformation(si.hStdError, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);

        PROCESS_INFORMATION pi;
        StringBuilder line = new StringBuilder(cmdline);
        // Suspended until it is in the job, so nothing it starts can escape.
        uint flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT;
        bool lowered = integrity != "medium";
        bool created = lowered
            ? CreateProcessAsUser(LowIntegrityToken(self, integrity == "low-read-only"), null, line, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, null, ref si, out pi)
            : CreateProcess(null, line, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, null, ref si, out pi);
        if (!created) Fail(lowered ? "CreateProcessAsUser" : "CreateProcess");
        if (!AssignProcessToJobObject(job, pi.hProcess))
        {
            int code = Marshal.GetLastWin32Error();
            TerminateProcess(pi.hProcess, 125);
            Fail("AssignProcessToJobObject", code);
        }
        ResumeThread(pi.hThread);
        WaitForSingleObject(pi.hProcess, INFINITE);
        uint exitCode;
        GetExitCodeProcess(pi.hProcess, out exitCode);
        // Like a Linux PID namespace: when the command exits, its leftovers go too.
        TerminateJobObject(job, exitCode);
        return (int)exitCode;
    }
}
